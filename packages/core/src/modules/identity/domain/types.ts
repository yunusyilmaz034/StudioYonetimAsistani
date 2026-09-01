import type { BranchId, Instant, StaffRole, StaffUserId } from '../../../shared'

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
