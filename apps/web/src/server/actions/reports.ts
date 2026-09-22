'use server'

import {
  debtByEntitlement,
  loadExcludedMemberIds,
  type TenantContext,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreIdentityRepository,
  FirestoreMemberRepository,
  FirestoreProjectionRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  localDateAt,
  systemClock,
} from '@studio/core'
import { z } from 'zod'

import {
  buildCash,
  buildCancellations,
  buildCheckins,
  buildCollections,
  buildDayEnd,
  buildMembership,
  buildNotes,
  buildReservations,
  type NotSatiri,
  buildSales,
  buildTrainer,
  type Report,
  buildDebts,
} from '@/lib/reports/build'
import type { ReportId } from '@/lib/reports/catalog'

import { requireTenantContext } from '../auth'
import { kindOfItemId } from '../checklist-snooze'
import { adminDb } from '../firebase-admin'

// THE REPORTS (v1.27 S6) — one action, one read per report, `ExportableTable` out.
//
// ── Owner only, and the export test says so structurally ────────────────────────────────────
// `/reports` is an owner-only area (owner, 2026-07-13). Every one of these is either the studio's
// business or its members' PII, and a CSV of it is that data in one file, on a laptop, forever.
//
// ── Each report reads ONLY what it needs ────────────────────────────────────────────────────
// There is no "load everything, then filter": a report over a month must not read a year. Every query
// here is bounded by the range the owner chose, and the two that are not (`membership`, `cash`) are
// bounded by the size of the studio itself.

const OWNER = ['owner'] as const

// Europe/Istanbul. Same constant as the dashboard and analytics — Türkiye has no DST, so the offset
// is a number, not a calculation. When a second country arrives this becomes `offsetMinutesAt(tz)`,
// which is why S2 stored the IANA zone rather than a number.
const OFFSET = 180

// The TRT midnight that starts the day `ms` falls in. The day-end report is a single day, so the
// range's end has to be pulled back to its own 00:00 — otherwise "Son 30 gün" would ask for a
// 30-day window starting at today's noon and read nothing.
function startOfDayMs(ms: number): number {
  const shifted = ms + OFFSET * 60_000
  return shifted - (shifted % 86_400_000) - OFFSET * 60_000
}

export interface ReportResult extends Report {
  readonly id: ReportId
}

/**
 * TEST HESAPLARI RAPORLARDA DA GÖRÜNMEZ (owner, 2026-09-02).
 *
 * `settings/projection.excludedMemberIds` günlük projeksiyonda ve panoda okunuyordu; raporlarda
 * okunmuyordu. Owner test hesabını üyelik raporunda borçlu olarak gördü: *"hiçbir kayıtta yunus
 * test gözükmesin."*
 *
 * Aynı liste, aynı anlam: olay silinmez, okuma modeli saymaz. Rapor bir okuma modelidir.
 */
async function haricTut<T extends { readonly memberId?: unknown; readonly id?: unknown }>(
  ctx: TenantContext,
  rows: readonly T[],
  alan: 'id' | 'memberId',
): Promise<readonly T[]> {
  const excluded = await loadExcludedMemberIds(adminDb(), ctx.studioId)
  if (excluded.size === 0) return rows
  return rows.filter((r) => !excluded.has(String(r[alan])))
}

export async function loadReportAction(input: unknown): Promise<ReportResult> {
  const p = z
    .object({
      id: z.enum(['membership', 'sales', 'collections', 'reservations', 'checkins', 'trainer', 'cancellations', 'dayend', 'debts', 'cash', 'notes']),
      fromMs: z.number(),
      toMs: z.number(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const db = adminDb()

  switch (p.id) {
    case 'membership': {
      const [members, entitlements, debt] = await Promise.all([
        new FirestoreMemberRepository(db).list(ctx),
        new FirestoreEntitlementRepository(db).listAll(ctx),
        debtByEntitlement({ repo: new FirestoreFinanceRepository(db), clock: systemClock }, ctx),
      ])
      return {
        id: p.id,
        ...buildMembership(
          await haricTut(ctx, members, 'id'),
          await haricTut(ctx, entitlements, 'memberId'),
          p.toMs,
          new Map([...debt].map(([id, m]) => [id, m.amount])),
        ),
      }
    }

    case 'sales': {
      const finance = new FirestoreFinanceRepository(db)
      const [sales, members, staff] = await Promise.all([
        finance.listSalesBetween(ctx, p.fromMs, p.toMs),
        new FirestoreMemberRepository(db).list(ctx),
        new FirestoreIdentityRepository(db).listStaff(ctx),
      ])
      return { id: p.id, ...buildSales(await haricTut(ctx, sales, 'memberId'), members, staff) }
    }

    case 'collections': {
      const finance = new FirestoreFinanceRepository(db)
      const [payments, members, drawers, staff] = await Promise.all([
        finance.listPaymentsBetween(ctx, p.fromMs, p.toMs),
        new FirestoreMemberRepository(db).list(ctx),
        finance.listDrawers(ctx),
        new FirestoreIdentityRepository(db).listStaff(ctx),
      ])
      return { id: p.id, ...buildCollections(await haricTut(ctx, payments, 'memberId'), members, drawers, staff) }
    }

    case 'notes': {
      // Notlar gün gün duruyor (`checklistDone/{YYYY-MM-DD}`), çünkü tik de gün günlük. Aralık kadar
      // belge okunur — bir ayın notları bir yılı okutmaz. Üst sınır 120 gün: "Tümü" seçen biri
      // stüdyonun bütün geçmişini tek sorguda çekmesin.
      const gunKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
      const gunler: string[] = []
      for (let t = startOfDayMs(p.fromMs); t <= p.toMs && gunler.length < 120; t += 86_400_000) gunler.push(gunKey(t))
      const kok = db.collection('studios').doc(ctx.studioId as string)
      const snaps = gunler.length === 0 ? [] : await db.getAll(...gunler.map((g) => kok.collection('checklistDone').doc(g)))

      type Ham = { at: number; byName: string; kind: string; title: string; note: string; itemId: string }
      const ham: Ham[] = []
      for (const snap of snaps) {
        const items = (snap.data()?.items ?? {}) as Record<
          string,
          { byName?: string; at?: number; note?: string; title?: string } | undefined
        >
        for (const [itemId, v] of Object.entries(items)) {
          const not = String(v?.note ?? '').trim()
          // Notu olmayan tik burada işi yok: bu rapor "ne yazıldı"yı sorar, "ne tiklendi"yi değil.
          if (!not) continue
          ham.push({
            at: Number(v?.at ?? 0),
            byName: String(v?.byName ?? '—'),
            kind: kindOfItemId(itemId) ?? 'info',
            title: String(v?.title ?? ''),
            note: not,
            itemId,
          })
        }
      }

      // İLGİLİ KİM: `wa:{telefon}` sohbetten, `{tür}__{memberId}…` üye kaydından çözülür. Çözülemeyen
      // kimlik boş bırakılır — uydurulmuş bir ad, boş bir hücreden kötüdür.
      const telefonlar = [...new Set(ham.filter((h) => h.itemId.startsWith('wa:')).map((h) => h.itemId.slice(3)))]
      const [members, sohbetler] = await Promise.all([
        new FirestoreMemberRepository(db).list(ctx),
        telefonlar.length === 0
          ? Promise.resolve([])
          : db.getAll(...telefonlar.map((t) => kok.collection('conversations').doc(t))),
      ])
      const adres = new Map(telefonlar.map((t, i) => [t, String(sohbetler[i]?.data()?.name ?? '').trim() || t]))
      const uyeAdi = new Map(members.map((m) => [m.id as string, m.fullName]))
      const konu = (itemId: string): string => {
        if (itemId.startsWith('wa:')) return adres.get(itemId.slice(3)) ?? itemId.slice(3)
        const parcalar = itemId.split('__')
        return parcalar.length > 1 ? (uyeAdi.get(parcalar[1] ?? '') ?? '') : ''
      }

      const satirlar: NotSatiri[] = ham.map((h) => ({
        at: h.at,
        byName: h.byName,
        kind: h.kind,
        subject: konu(h.itemId),
        title: h.title,
        note: h.note,
      }))
      return { id: p.id, ...buildNotes(satirlar) }
    }

    case 'cancellations': {
      // Kırmızı liste: iptaller İPTAL ANINA göre, seçilen aralıkta. Test hesapları burada da yok.
      const [cancelled, members] = await Promise.all([
        new FirestoreReservationRepository(db).listCancelledResolvedBetween(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
        new FirestoreMemberRepository(db).list(ctx),
      ])
      return {
        id: p.id,
        ...buildCancellations(await haricTut(ctx, cancelled, 'memberId'), members, Date.now()),
      }
    }

    case 'checkins': {
      const [checkIns, members] = await Promise.all([
        new FirestoreCheckinRepository(db).listCheckInsBetween(ctx, p.fromMs, p.toMs),
        new FirestoreMemberRepository(db).list(ctx),
      ])
      // Test hesapları raporlarda görünmez (2026-09-02) — check-in raporunda da.
      return { id: p.id, ...buildCheckins(await haricTut(ctx, checkIns, 'memberId'), members) }
    }

    case 'reservations': {
      const [reservations, sessions] = await Promise.all([
        new FirestoreReservationRepository(db).listBySessionStartRange(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
        new FirestoreSchedulingRepository(db).listSessionsForDay(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
      ])
      return { id: p.id, ...buildReservations(reservations, sessions) }
    }

    case 'trainer': {
      const [sessions, reservations] = await Promise.all([
        new FirestoreSchedulingRepository(db).listSessionsForDay(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
        new FirestoreReservationRepository(db).listBySessionStartRange(
          ctx,
          instant(p.fromMs),
          instant(p.toMs),
        ),
      ])
      return { id: p.id, ...buildTrainer(sessions, reservations) }
    }

    case 'dayend': {
      // ONE day, and it is the LAST of whatever range she picked (owner, 2026-09-17). Summing a month
      // into a page headed "Gün sonu" would stop it being reconcilable against the till, so the report
      // stays single-day — but taking the range's FIRST day meant "Son 30 gün" answered with a day a
      // month ago, which reads as broken arithmetic. The last day is the one she is actually asking
      // about: "Bugün" and "Dün" are unchanged, and a longer range lands on the most recent close.
      const dayStart = startOfDayMs(p.toMs)
      const dayEndMs = dayStart + 86_400_000 - 1
      const label = localDateAt(instant(dayStart), OFFSET) as string
      const finance = new FirestoreFinanceRepository(db)
      const [daily, payments, sales, drawers] = await Promise.all([
        new FirestoreProjectionRepository(db).getDaily(ctx, label),
        finance.listPaymentsBetween(ctx, dayStart, dayEndMs),
        finance.listSalesBetween(ctx, dayStart, dayEndMs),
        finance.listDrawers(ctx),
      ])
      return { id: p.id, ...buildDayEnd(label, daily, payments, sales, drawers) }
    }

    case 'debts': {
      // Tarih aralığı OKUNMUYOR — borç bugünkü durumdur (bkz. katalog: `time: 'state'`).
      const finance = new FirestoreFinanceRepository(db)
      const [open, members] = await Promise.all([
        finance.listOpenSales(ctx),
        new FirestoreMemberRepository(db).list(ctx),
      ])
      // TEST HESAPLARI BORÇLU DEĞİLDİR (owner, 2026-09-16): *"Işıl Yılmaz'ı test kullanıcısı gibi davran, borçlu
      // falan değil."* Hesap zaten `settings/projection.excludedMemberIds` içindeydi; bu rapor listeyi okumuyordu.
      return { id: p.id, ...buildDebts(await haricTut(ctx, open, 'memberId'), members, Date.now()) }
    }

    case 'cash': {
      const finance = new FirestoreFinanceRepository(db)
      const [all, staff] = await Promise.all([
        finance.listDrawers(ctx),
        new FirestoreIdentityRepository(db).listStaff(ctx),
      ])
      // A drawer is a small, bounded set (one or two per branch), so it is filtered in memory rather
      // than indexed: an index earned by no query is a cost paid for nothing.
      const inRange = all.filter(
        (d) => d.openedAt !== null && d.openedAt >= p.fromMs && d.openedAt <= p.toMs,
      )
      return { id: p.id, ...buildCash(inRange, staff) }
    }
  }
}
