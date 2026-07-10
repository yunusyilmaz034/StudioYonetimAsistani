import type { Brand, BranchId, Instant, LocalDate, MemberId, StudioId } from '../../../shared'

// PII lives on the Member and nowhere else (I-13, AD-10). Events reference a
// member by opaque MemberId only.

export type PhoneE164 = Brand<string, 'PhoneE164'>
export type Email = Brand<string, 'Email'>

export type MemberStatus = 'active' | 'inactive' | 'deleted'

export interface EmergencyContact {
  readonly name: string
  readonly phone: PhoneE164
}

// Denormalised, always rebuildable from events; never authoritative (Doc 2 §4).
export interface MemberStats {
  readonly lastAttendanceAt: Instant | null
  readonly lastCheckInAt: Instant | null
  readonly totalAttended: number
  readonly activeEntitlementCount: number
  readonly balanceDue: number // kuruş
}

export interface Member {
  readonly id: MemberId
  readonly studioId: StudioId
  readonly homeBranchId: BranchId | null

  // ── PII ──
  readonly fullName: string
  readonly phone: PhoneE164
  readonly phoneNormalized: string // digits only, no '+'; the uniqueness key
  readonly email: Email | null
  readonly birthDate: LocalDate | null
  readonly notes: string | null
  readonly emergencyContact: EmergencyContact | null

  readonly status: MemberStatus
  readonly joinedAt: Instant
  readonly stats: MemberStats
}

export const emptyStats = (): MemberStats => ({
  lastAttendanceAt: null,
  lastCheckInAt: null,
  totalAttended: 0,
  activeEntitlementCount: 0,
  balanceDue: 0,
})
