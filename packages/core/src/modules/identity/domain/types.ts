import type { BranchId, Instant, StaffRole, StaffUserId } from '../../../shared'
import type { LeaveKind } from '../events'

// A staff principal, as the scheduling pickers need to name one (assign/change a
// session's trainer). Phase 1 is read-only: staff exist as auth principals with
// custom claims plus a `/staff` document; creation-with-events is a later milestone.
// Any active staff member may be a session's trainer (a small studio's owner teaches).
export interface StaffMember {
  readonly id: StaffUserId
  readonly displayName: string
  readonly role: StaffRole
  readonly active: boolean
}

/**
 * Bir vardiya: başladı, belki bitti.
 *
 * `endedAt === null` AÇIK vardiya demek — ve aynı anda bir kişinin yalnızca bir açık vardiyası
 * olabilir. Bu kural belgenin kimliğinde değil kararda duruyor, çünkü "bugünün vardiyası" diye bir
 * şey yok: gece yarısını geçen bir mesai hâlâ tek bir vardiyadır.
 */
export interface StaffShift {
  readonly id: string
  readonly staffUserId: StaffUserId
  readonly branchId: BranchId | null
  readonly startedAt: Instant
  readonly endedAt: Instant | null
}

/**
 * Bir yokluk kaydı: talep edildi, onaylandı ya da reddedildi.
 *
 * TARİHLER GÜN SINIRIDIR, an değil. `from` stüdyo yerel gününün başı, `to` son günün SONU (dahil).
 * Sebebi pratik: insanlar "12–15 Eylül yokum" der, "12 Eylül 00:00'dan 15 Eylül 23:59'a" demez —
 * ve saat taşıyan bir izin, yarım gün tartışması açar. Yarım gün gerekirse ayrı bir kavramdır.
 */
export interface StaffLeave {
  readonly id: string
  readonly staffUserId: StaffUserId
  readonly kind: LeaveKind
  readonly from: Instant
  readonly to: Instant
  readonly note: string
  readonly status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  readonly requestedAt: Instant
  /** Kim karar verdi — ONAYLAYAN BİR PRENSİPTİR (#5) ve adı değil kimliği yazılır. */
  readonly decidedBy: StaffUserId | null
  readonly decidedAt: Instant | null
  /** Reddin sebebi. Sebepsiz bir red, çalışana hiçbir şey söylemez. */
  readonly decisionReason: string
}
