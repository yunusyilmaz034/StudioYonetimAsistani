import type { BranchId, Instant, ReservationOverride } from '../../shared'

export const MEMBER_REGISTERED = 'member.registered'
export const MEMBER_PROFILE_UPDATED = 'member.profile_updated'
export const MEMBER_DEACTIVATED = 'member.deactivated'

// ── "Kısıtlı Üyelik" (Plus Phase 3) ──────────────────────────────────────────────────────────
// A member restriction is an override of the package rules, set/cleared by staff. Like the erasure
// reason, the WHY is a CLOSED ENUM in the log; the free-text `note` a human writes lives on member
// STATE, never here. The structured `rules` are PII-free (weekdays, hour windows, counts) and are
// safe to record — they are what makes "why was she refused?" answerable from the log.
export const MEMBER_RESTRICTION_SET = 'member.restriction_set'
export const MEMBER_RESTRICTION_CLEARED = 'member.restriction_cleared'
// The WHY of a restriction — a closed enum (like the erasure reason), so the log stays analysable
// and free of the PII a free-text reason could smuggle in. VIP/corporate/promotional loosen; problem
// tightens; other is the escape hatch. Lives here (not on the Member) so events.ts imports nothing
// from domain/member — that would be a cycle.
export const RestrictionReasons = ['vip', 'corporate', 'promotional', 'problem', 'other'] as const
export type RestrictionReason = (typeof RestrictionReasons)[number]

// v1.21 — the member portal. `member.invited` is emitted by STAFF; the other two by the MEMBER
// herself (actor: { type: 'member' }), which is the entire point of the actor taxonomy: her
// first login is attributable to her, not to the receptionist who wasn't there.
export const MEMBER_INVITED = 'member.invited'
export const MEMBER_PORTAL_ACTIVATED = 'member.portal_activated'
export const MEMBER_PORTAL_LOGIN = 'member.portal_login'

// v1.26 — KVKK/GDPR erasure (owner, 2026-07-13 · AD-67).
//
// The one act that DELETES identity, and it must therefore be the most carefully logged act in the
// system: a deletion nobody recorded is indistinguishable from a deletion somebody did to hide
// something. So the log keeps the *fact* of the erasure — permanently, anonymously — while the
// identity it erased is gone from state.
//
// **The reason is a CLOSED ENUM, and that is not tidiness.** A free-text reason is the last place
// PII can hide in an immutable log ("Ayşe Yılmaz'ın avukatı aradı"), and the log is forever. The
// enum makes the erasure analysable; a `note` — where a human explains — lives on the member's
// tombstone in STATE, where it can itself be erased.
export const MEMBER_ERASED = 'member.erased'
export const ErasureReasons = [
  'kvkk_request',
  'duplicate',
  'test_data',
  'legal_requirement',
  'owner_request',
] as const
export type ErasureReason = (typeof ErasureReasons)[number]

// No PII in any payload (I-13). member.registered carries no name; the identity is
// in /members. member.profile_updated carries changed field NAMES only (AD-25).
// (Type aliases, not interfaces, so they satisfy the EventPayload `Record` shape.)
export type MemberRegisteredPayload = {
  readonly homeBranchId: BranchId | null
  readonly joinedAt: Instant
}

export type MemberProfileUpdatedPayload = {
  readonly changedFields: readonly string[]
}

export type MemberDeactivatedPayload = {
  readonly reason: string
}

// The invite TOKEN is never in the payload — it is a bearer credential, and events are
// permanent (I-13 in spirit: a secret is worse than PII in an immutable log). What the log
// records is that an invite was issued and when it dies.
export type MemberInvitedPayload = {
  readonly expiresAt: Instant
}
export type MemberPortalActivatedPayload = Record<string, never>
export type MemberPortalLoginPayload = Record<string, never>

// The memberId is an OPAQUE id — it is already on every event she ever caused, and it now resolves
// to nobody. That is what erasure means here: not amnesia, but severing the link between behaviour
// and a person. No name, no phone, no e-mail, no free text. Ever.
export type MemberErasedPayload = {
  readonly memberId: string
  readonly reason: ErasureReason
  readonly erasedAt: Instant
}

// The structured rules DO enter the log (they are not PII); the note does NOT.
export type MemberRestrictionSetPayload = {
  readonly reason: RestrictionReason
  readonly rules: ReservationOverride
}
export type MemberRestrictionClearedPayload = {
  readonly reason: string
}
