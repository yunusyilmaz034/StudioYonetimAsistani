import type { BranchId, Instant } from '../../shared'

export const MEMBER_REGISTERED = 'member.registered'
export const MEMBER_PROFILE_UPDATED = 'member.profile_updated'
export const MEMBER_DEACTIVATED = 'member.deactivated'

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
