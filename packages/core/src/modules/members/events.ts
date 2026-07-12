import type { BranchId, Instant } from '../../shared'

export const MEMBER_REGISTERED = 'member.registered'
export const MEMBER_PROFILE_UPDATED = 'member.profile_updated'
export const MEMBER_DEACTIVATED = 'member.deactivated'

// v1.21 — the member portal. `member.invited` is emitted by STAFF; the other two by the MEMBER
// herself (actor: { type: 'member' }), which is the entire point of the actor taxonomy: her
// first login is attributable to her, not to the receptionist who wasn't there.
export const MEMBER_INVITED = 'member.invited'
export const MEMBER_PORTAL_ACTIVATED = 'member.portal_activated'
export const MEMBER_PORTAL_LOGIN = 'member.portal_login'

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
