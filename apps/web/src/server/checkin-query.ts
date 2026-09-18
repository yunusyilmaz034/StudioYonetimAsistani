import {
  FirestoreSchedulingRepository,
  FirestoreCheckinRepository,
  FirestoreReservationRepository,
  instant,
  type BranchId,
  type TenantContext,
} from '@studio/core'

import { DAY_MS, studioDayStart } from '@/lib/ranges'

import { adminDb } from './firebase-admin'

export interface InsideMember {
  readonly memberId: string
  readonly checkedInAt: number
}
export interface ExpectedMember {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly sessionStartsAt: number
}
// ── BUGÜNÜN CANLI RAKAMLARI (owner, 2026-09-15) ──────────────────────────────────────────────
// *"Bu ekranda bugün canlı rakamlar, bir de altta bugün check-in yapanlar olsun."* Tek okuma: şubenin bugünkü
// check-in kayıtları (`listCheckInsForDay`, stüdyo günü 00:00'dan). Kişi başına tek satır — aynı üyenin gün içindeki
// ikinci girişi ayrı satır değil, sayıdır.
export interface TodayRow {
  readonly memberId: string
  readonly firstIn: number | null // null ⇒ bugün yalnızca çıkışı var (girişi kayıtsız, OR-75)
  readonly lastOut: number | null
  readonly entries: number
  readonly via: readonly string[] // 'device' | 'qr' | 'reception'
}
export interface TodayStats {
  readonly entries: number
  readonly uniqueMembers: number
  readonly exits: number
  readonly byMethod: { readonly device: number; readonly qr: number; readonly reception: number }
  /** Bugün giren ÜYELERİN ne için geldiği (kişi başına tek sayım). Toplamı `uniqueMembers`'a eşittir. */
  readonly byPurpose: { readonly pilates: number; readonly fitness: number; readonly pt: number }
  readonly rows: readonly TodayRow[]
}
const EMPTY_TODAY: TodayStats = {
  entries: 0,
  uniqueMembers: 0,
  exits: 0,
  byMethod: { device: 0, qr: 0, reception: 0 },
  byPurpose: { pilates: 0, fitness: 0, pt: 0 },
  rows: [],
}

export interface CheckinState {
  readonly branchId: string | null
  readonly isOpen: boolean
  readonly occupancy: number
  readonly inside: readonly InsideMember[]
  readonly expectedSoon: readonly ExpectedMember[]
  readonly today: TodayStats
}

// v1.27 S4 — what a studio gets before its owner has opened the settings screen. The window itself
// is DATA (`qr.checkInWindowMinutes`), not a literal: a studio whose classes start on the hour wants
// a different one from a studio that runs back-to-back PT.
const DEFAULT_SOON_MINUTES = 15

// The check-in screen's read: the branch open state, who is currently inside, and the
// "expected but absent" list (D6) — reservations starting within the check-in window whose member is
// not currently inside. Bounded reads; occupancy is NOT a projection (Phase 2).
export async function loadCheckinState(ctx: TenantContext, nowMs: number): Promise<CheckinState> {
  const branchId = (ctx.branchIds[0] ?? null) as BranchId | null
  if (!branchId) {
    return { branchId: null, isOpen: false, occupancy: 0, inside: [], expectedSoon: [], today: EMPTY_TODAY }
  }
  const db = adminDb()
  const checkinRepo = new FirestoreCheckinRepository(db)

  const settings = await new FirestoreSchedulingRepository(db).getStudioSettings(ctx)
  const soonMs = (settings?.qr?.checkInWindowMinutes ?? DEFAULT_SOON_MINUTES) * 60_000

  const reservationRepo = new FirestoreReservationRepository(db)
  const dayStart = studioDayStart(nowMs)
  const [branch, inside, upcoming, todays, dayReservations] = await Promise.all([
    checkinRepo.getBranch(ctx, branchId),
    checkinRepo.listPresence(ctx, branchId),
    reservationRepo.listBySessionStartRange(ctx, instant(nowMs), instant(nowMs + soonMs)),
    checkinRepo.listCheckInsForDay(ctx, branchId, instant(dayStart)),
    reservationRepo.listBySessionStartRange(ctx, instant(dayStart), instant(dayStart + DAY_MS)),
  ])

  // ── BUGÜN KİM NE İÇİN GELDİ (owner, 2026-09-18) ────────────────────────────────────────────
  //
  // Bir check-in kaydı "neden geldiğini" bilmez — kapıdan geçiş, dersin kendisi değildir. O yüzden
  // amacı REZERVASYON söyler: bugün rezervasyonu olan üye o dersin kategorisi için gelmiştir.
  // Rezervasyonu olmayan giriş serbest kullanımdır, yani fitness: bu stüdyoda reformer ve PT
  // rezervasyonsuz kullanılamaz, sınırsız fitness ise hiç rezervasyon yapmaz.
  //
  // İPTAL SAYILMAZ: iptal ettiği dersin kategorisi, o gün kapıdan geçmesinin sebebi olamaz.
  const amac = new Map<string, string>()
  for (const r of dayReservations) {
    if (r.status === 'cancelled') continue
    if (!amac.has(r.memberId)) amac.set(r.memberId, r.sessionCategory)
  }

  const insideIds = new Set(inside.map((p) => p.memberId))
  const expectedSoon = upcoming
    .filter((r) => r.status === 'booked' && !insideIds.has(r.memberId))
    .map((r) => ({
      reservationId: r.id,
      memberId: r.memberId,
      memberName: r.memberSnapshot.displayName,
      sessionStartsAt: r.sessionStartsAt,
    }))
    .sort((a, b) => a.sessionStartsAt - b.sessionStartsAt)

  return {
    today: summarizeToday(todays, amac),
    branchId,
    isOpen: branch?.isOpen ?? false,
    occupancy: inside.length,
    inside: inside
      .map((p) => ({ memberId: p.memberId, checkedInAt: p.checkedInAt }))
      .sort((a, b) => b.checkedInAt - a.checkedInAt),
    expectedSoon,
  }
}

function summarizeToday(
  todays: readonly { memberId: string; direction: string; method: string; occurredAt: number }[],
  amac: ReadonlyMap<string, string> = new Map(),
): TodayStats {
  const sorted = [...todays].sort((a, b) => a.occurredAt - b.occurredAt)
  const byMember = new Map<string, { firstIn: number | null; lastOut: number | null; entries: number; via: Set<string> }>()
  const byMethod = { device: 0, qr: 0, reception: 0 }
  let entries = 0
  let exits = 0
  for (const c of sorted) {
    const row = byMember.get(c.memberId) ?? { firstIn: null, lastOut: null, entries: 0, via: new Set<string>() }
    if (c.direction === 'in') {
      entries++
      row.entries++
      row.firstIn ??= c.occurredAt
      row.via.add(c.method)
      if (c.method === 'device' || c.method === 'qr' || c.method === 'reception') byMethod[c.method]++
    } else {
      exits++
      row.lastOut = c.occurredAt
    }
    byMember.set(c.memberId, row)
  }
  const rows = [...byMember]
    .map(([memberId, r]) => ({ memberId, firstIn: r.firstIn, lastOut: r.lastOut, entries: r.entries, via: [...r.via] }))
    .sort((a, b) => (b.firstIn ?? b.lastOut ?? 0) - (a.firstIn ?? a.lastOut ?? 0))
  // Kişi başına tek sayım: aynı üyenin ikinci girişi ayrı bir "kim geldi" değildir. Rezervasyonu
  // olmayan giriş fitness sayılır (yukarıdaki gerekçe).
  const byPurpose = { pilates: 0, fitness: 0, pt: 0 }
  for (const r of rows.filter((r) => r.entries > 0)) {
    const k = amac.get(r.memberId)
    if (k === 'pilates_group') byPurpose.pilates++
    else if (k === 'private') byPurpose.pt++
    else byPurpose.fitness++
  }
  return { entries, uniqueMembers: rows.filter((r) => r.entries > 0).length, exits, byMethod, byPurpose, rows }
}
