import type { Brand, BranchId, Instant, LocalDate, MemberId, ReservationOverride, StudioId } from '../../../shared'
import type { ErasureReason, RestrictionReason } from '../events'

// ── "Kısıtlı Üyelik" — a member's override of the package rules (Plus Phase 3) ────────────────
// Read FIRST at reservation time (member → package → studio default). It only ever tightens or
// loosens THIS member and never touches the catalogue. The structured rules are a PII-free
// `ReservationOverride` and DO enter the audit event; `note` is free text, lives HERE like the
// erasure note (the last place PII hides), and never enters the log. `RestrictionReason` lives in
// events.ts (not here) so events.ts imports nothing from this file — that would be a dependency cycle.
export interface MemberRestriction extends ReservationOverride {
  readonly reason: RestrictionReason
  readonly note: string
}

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

  // "Kısıtlı Üyelik" (Plus Phase 3). null ⇒ an ordinary member, judged by package + studio rules.
  readonly restriction: MemberRestriction | null

  // ── The tombstone (v1.26 · AD-67) ──
  // Set when she has been erased. The record is KEPT, not deleted: deleting it would break every
  // join in the system — her reservations, her payments, her credits all point here — and turn a
  // lawful erasure into a corrupt database. It says, truthfully: *this member existed, she asked to
  // be forgotten, and on this date we forgot her.*
  //
  // `note` is where a human explains, and it lives HERE rather than in the event because free text
  // is the last place PII hides — and unlike the log, this can itself be erased.
  readonly erased?: {
    readonly at: Instant
    readonly reason: ErasureReason
    readonly note: string | null
  }
}

export const emptyStats = (): MemberStats => ({
  lastAttendanceAt: null,
  lastCheckInAt: null,
  totalAttended: 0,
  activeEntitlementCount: 0,
  balanceDue: 0,
})

// The bounded member snapshot copied onto a reservation for the trainer's roster
// (OQ-12, AD-44, Doc 3 §4.4). FOUR fields — enough to render a roster and tell two
// members apart, never enough to reconstruct a person. Never enters an event
// (I-13); purged on erasure. This is the ONLY builder — members owns it, so the
// derivation never drifts, and `reservations` never depends on `members` PII.
export type MembershipStatus = 'active' | 'inactive'

export interface MemberSnapshot {
  readonly memberId: MemberId
  readonly displayName: string // given name + surname initial — not the full legal name
  readonly phoneLast4: string
  readonly membershipStatus: MembershipStatus
}

export function toMemberSnapshot(member: Member): MemberSnapshot {
  const parts = member.fullName.trim().split(/\s+/)
  const given = parts[0] ?? ''
  const surnameInitial = parts.length > 1 ? `${parts[parts.length - 1]?.charAt(0) ?? ''}.` : ''
  const displayName = surnameInitial ? `${given} ${surnameInitial}` : given
  return {
    memberId: member.id,
    displayName,
    phoneLast4: member.phoneNormalized.slice(-4),
    membershipStatus: member.status === 'active' ? 'active' : 'inactive',
  }
}
