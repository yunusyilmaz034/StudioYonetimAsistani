'use server'

import {
  FirestoreSchedulingRepository,
  FirestoreIdentityRepository,
  FirestoreStaffLeaveRepository,
  cancelStaffLeave,
  decideStaffLeave,
  requestStaffLeave,
  systemClock,
  type StaffUserId,
  type TenantContext,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── İZİN / YOKLUK (owner onayı, 2026-09-11) ─────────────────────────────────────────────────
//
// Eklenen şey izin BAKİYESİ değil YOKLUKTUR. Fark ürünün tamamını belirliyor ve gerekçesi
// `identity/events.ts`te: yıllık hak / devreden gün / kıdem aritmetiği İK yazılımıdır ve owner'ın
// hiçbir günlük kararını değiştirmez. Değiştirdiği karar şu — **eğitmen yarın yok, o gün ona
// atanmış dersler sahipsiz.**
//
// AKTÖR HER ZAMAN OTURUM. `staffUserId` istemciden alınmıyor: alsaydık ekrandaki bir alanı
// değiştiren biri başkasının adına izin isteyebilirdi.

const HERKES = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const KARAR_VERENLER = ['owner', 'platform_admin'] as const

/**
 * O aralıkta bu eğitmene atanmış, İPTAL EDİLMEMİŞ ders sayısı.
 *
 * Bu, izin modülünün takvime sorduğu TEK soru — ve ayrı bir port olmasının sebebi de o: izin
 * takvimi tanımıyor, yalnızca bir sayı istiyor.
 */
const etkilenenDersler = async (ctx: TenantContext, staffUserId: StaffUserId, fromAt: number, toAt: number) => {
  // `listSessionsForDay` adı gün diyor ama işi aralık: `startsAt ∈ [from, to)`. İzin aralığı bir
  // günden uzun olabildiği için doğrudan onu kullanıyoruz — yeni bir sorgu açmak, aynı işi ikinci
  // kez yazmak olurdu.
  const sessions = await new FirestoreSchedulingRepository(adminDb()).listSessionsForDay(ctx, fromAt as never, (toAt + 1) as never)
  return sessions.filter((s) => s.status !== 'cancelled' && String(s.trainerId ?? '') === String(staffUserId)).length
}

const deps = () => ({
  repo: new FirestoreStaffLeaveRepository(adminDb()),
  clock: systemClock,
  affectedSessions: etkilenenDersler,
})

// Gün SINIRLARI stüdyo yerel saatiyle: insanlar "12–15 Eylül yokum" der. Saat taşıyan bir izin,
// yarım gün tartışması açar ve yarım gün ayrı bir kavramdır.
const gunBasi = (yerelTarih: string): number => new Date(`${yerelTarih}T00:00:00+03:00`).getTime()
const gunSonu = (yerelTarih: string): number => new Date(`${yerelTarih}T23:59:59.999+03:00`).getTime()

export async function requestLeaveAction(input: unknown) {
  const p = z
    .object({
      kind: z.enum(['izin', 'rapor', 'egitim', 'diger']),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().trim().max(400).default(''),
      // Owner bir çalışan ADINA girebilir (telefonla haber veren eğitmen). Verilmezse oturumun
      // kendisi. Domain zaten "başkası adına" durumunu yalnızca yetkiliye açıyor.
      staffUserId: z.string().min(1).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(HERKES)
  return requestStaffLeave(deps(), ctx, {
    staffUserId: (p.staffUserId ?? String(ctx.actor.id)) as StaffUserId,
    kind: p.kind,
    from: gunBasi(p.from),
    to: gunSonu(p.to),
    note: p.note,
  })
}

export async function decideLeaveAction(input: unknown) {
  const p = z.object({ leaveId: z.string().min(1), approve: z.boolean(), reason: z.string().trim().max(300).optional() }).parse(input)
  const ctx = await requireTenantContext(KARAR_VERENLER)
  return decideStaffLeave(deps(), ctx, {
    leaveId: p.leaveId,
    approve: p.approve,
    ...(p.reason ? { reason: p.reason } : {}),
  })
}

export async function cancelLeaveAction(input: unknown) {
  const p = z.object({ leaveId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(HERKES)
  return cancelStaffLeave(deps(), ctx, p.leaveId)
}

export interface LeaveRow {
  readonly id: string
  readonly staffUserId: string
  readonly staffName: string
  readonly kind: string
  readonly fromMs: number
  readonly toMs: number
  readonly days: number
  readonly note: string
  readonly status: string
  readonly decisionReason: string
  /** Onay ekranının asıl bilgisi: bu aralıkta kaç ders sahipsiz kalacak. */
  readonly affectedSessions: number
}

const GUN = 86_400_000

/**
 * Ekranın listesi: bekleyenler + yaklaşan onaylılar.
 *
 * ETKİLENEN DERS SAYISI HER SATIRDA. Onay ekranında "kaç ders" yazmıyorsa, onaylayan kişi o soruyu
 * takvime kendisi gidip soracak demektir — ve sormaz.
 */
export async function listLeavesAction(): Promise<readonly LeaveRow[]> {
  const ctx = await requireTenantContext(HERKES)
  const repo = new FirestoreStaffLeaveRepository(adminDb())
  const now = Date.now()
  // Bekleyenler + bugünden itibaren 90 güne değen canlı izinler. Geçmiş izinler bu ekranın konusu
  // değil: yapılacak bir iş bırakmıyorlar.
  const [bekleyen, yakin] = await Promise.all([repo.listPendingLeaves(ctx), repo.listLeavesOverlapping(ctx, now, now + 90 * GUN)])
  const hepsi = [...bekleyen, ...yakin.filter((l) => !bekleyen.some((b) => b.id === l.id))]
  if (hepsi.length === 0) return []

  const staff = await new FirestoreIdentityRepository(adminDb()).listStaff(ctx)
  const ad = new Map(staff.map((s) => [String(s.id), s.displayName]))

  const rows = await Promise.all(
    hepsi.map(async (l) => ({
      id: l.id,
      staffUserId: String(l.staffUserId),
      staffName: ad.get(String(l.staffUserId)) ?? 'Bilinmeyen',
      kind: l.kind,
      fromMs: l.from as number,
      toMs: l.to as number,
      days: Math.max(1, Math.round(((l.to as number) - (l.from as number)) / GUN)),
      note: l.note,
      status: l.status,
      decisionReason: l.decisionReason,
      affectedSessions: await etkilenenDersler(ctx, l.staffUserId, l.from as number, l.to as number),
    })),
  )
  return rows.sort((a, b) => (a.status === 'pending' && b.status !== 'pending' ? -1 : a.status !== 'pending' && b.status === 'pending' ? 1 : a.fromMs - b.fromMs))
}
