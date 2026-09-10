'use server'

import {
  cancelReservation,
  cancelSession,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  systemClock,
  DEFAULT_STUDIO_CONFIG,
  type ClassSessionId,
  type ReservationId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { reservationPolicyPort } from '../reservation-policy'

// ── SEANS İPTALİ: KREDİ GECEYE KALMAZ (owner, 2026-09-10) ───────────────────────────────────
//
// *"Seans 6 saatten daha önce ise iptal edilen seanstaki krediler geri verilmiyor, kredi düşmüş
// sayılıyor ama seans iptal oluyor."*
//
// Ölçüldü ve doğru çıktı — ama sebebi tahmin edilenden başkaydı. `cancelSession` seansı iptal
// ediyor ve REZERVASYONLARA HİÇ DOKUNMUYOR. Rezervasyonlar `booked` kalıyor, krediler `held`
// (tutuluyor) kalıyor: üyenin kullanılabilir hakkı düşük görünüyor ve yeniden rezervasyon
// yapamıyor. Domainde koruma var (I-27: iptal edilen seansın kredisi HER ZAMAN iade edilir) ama o
// koruma yalnızca GECE SÜPÜRMESİNDE çalışıyor — seansın bitiş saati + 15 dakika geçtikten sonra.
//
// Yani kredi kaybolmuyordu, saatlerce rehin kalıyordu. Üye için ikisi aynı şey: hakkı yok.
//
// ── NEDEN AYRI BİR DOSYA ────────────────────────────────────────────────────────────────────
//
// İki modülü (scheduling + reservations) sırayla çağırıyor. Modüller birbirinin kapısından geçmez;
// ikisini birden tanıyan yer burasıdır — bileşim kökü.
//
// ── ATOMİK DEĞİL, VE OLMASI GEREKMİYOR ──────────────────────────────────────────────────────
//
// Seans ve her rezervasyon ayrı aggregate; tek işlemde yazılmıyorlar. Yarıda kalırsa seans iptal,
// bazı krediler hâlâ tutuluyor olur — ve gece süpürmesi (I-27) onları zaten serbest bırakır.
// Yani en kötü hâl, BUGÜNKÜ hâldir: kendini onarıyor.

const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const deps = () => ({
  repo: new FirestoreSchedulingRepository(adminDb()),
  clock: systemClock,
  studioConfig: DEFAULT_STUDIO_CONFIG,
  hours: new FirestoreStudioHours(adminDb()),
})
const resDeps = () => ({
  repo: new FirestoreReservationRepository(adminDb()),
  clock: systemClock,
  hours: new FirestoreStudioHours(adminDb()),
  policy: reservationPolicyPort(),
})

export interface SessionCancelImpact {
  readonly memberId: string
  readonly memberName: string
  /** Bu rezervasyon bir kredi TUTUYOR mu? Süresiz üyelikte tutmuyor — ve iade edilecek bir şey yok. */
  readonly holdsCredit: boolean
}

/**
 * İPTALDEN ÖNCE: kim etkilenecek, kaç kredi geri verilecek.
 *
 * Ekran bunu gösterip onay istiyor. Kimin etkilendiğini görmeden verilen bir iptal kararı, sonuçları
 * ertesi gün telefonla öğrenilen bir karardır.
 */
export async function sessionCancelImpactAction(input: unknown): Promise<{
  readonly rows: readonly SessionCancelImpact[]
  readonly creditsToReturn: number
}> {
  const p = z.object({ sessionId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const list = await new FirestoreReservationRepository(adminDb()).listBySession(ctx, p.sessionId as ClassSessionId)
  const booked = list.filter((r) => r.status === 'booked')
  if (booked.length === 0) return { rows: [], creditsToReturn: 0 }

  // İsim rezervasyonda YOK (olaylarda PII olmaz) — `/members`ten okunuyor, satır sayısı kadar.
  const db = adminDb()
  const uyeler = await db.getAll(
    ...booked.map((r) => db.collection('studios').doc(ctx.studioId).collection('members').doc(String(r.memberId))),
  )
  const ad = new Map(uyeler.map((d) => [d.id, String(d.get('fullName') ?? '')]))

  const rows = booked.map((r) => ({
    memberId: String(r.memberId),
    memberName: ad.get(String(r.memberId)) || 'Bilinmeyen üye',
    holdsCredit: r.creditEffect !== 'none',
  }))
  return { rows, creditsToReturn: rows.filter((r) => r.holdsCredit).length }
}

/**
 * Seansı iptal et ve tutulan kredileri HEMEN iade et.
 *
 * SIRA ÖNEMLİ: önce seans iptal edilir, sonra rezervasyonlar. `decideCancellation` seansın iptal
 * olduğunu GÖRÜNCE krediyi koşulsuz iade ediyor (I-14) — 6 saat penceresine hiç bakmadan, çünkü
 * iptal eden stüdyo, üye değil. Ters sırada çalıştırsaydık her rezervasyon "geç iptal" sayılır ve
 * kredileri yakardık. Bu satırların sırası, kuralın kendisidir.
 */
export async function cancelSessionWithRefundAction(input: unknown) {
  const p = z.object({ sessionId: z.string().min(1), reason: z.string().trim().min(1) }).parse(input)
  const ctx = await requireTenantContext(OPS)

  const cancelled = await cancelSession(deps(), ctx, {
    sessionId: p.sessionId as ClassSessionId,
    reason: p.reason,
  })
  if (!cancelled.ok) return { ok: false as const, error: cancelled.error, refunded: 0, failed: 0 }

  const list = await new FirestoreReservationRepository(adminDb()).listBySession(ctx, p.sessionId as ClassSessionId)
  let refunded = 0
  let failed = 0
  for (const r of list.filter((x) => x.status === 'booked')) {
    // Tek tek: biri düşerse öbürleri yine iade edilsin. Toplu bir işlem, bir üyenin kilitli
    // paketi yüzünden yirmi kişinin kredisini rehin bırakırdı.
    const res = await cancelReservation(resDeps(), ctx, { reservationId: r.id as ReservationId })
    if (res.ok) refunded += 1
    else failed += 1
  }
  // `failed` YUTULMUYOR: ekran onu yazıyor. Sessizce başarılı görünen bir iptal, ertesi gün
  // "kredim gelmemiş" telefonuyla öğrenilir.
  return { ok: true as const, refunded, failed }
}
