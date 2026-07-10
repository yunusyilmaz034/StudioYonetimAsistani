// The members module's only public door (AD-29).
export type {
  Email,
  EmergencyContact,
  Member,
  MembershipStatus,
  MemberSnapshot,
  MemberStats,
  MemberStatus,
  PhoneE164,
} from './domain/member'
export { toMemberSnapshot } from './domain/member'
export { normalizePhone, type NormalizedPhone } from './domain/phone'
export {
  MEMBER_DEACTIVATED,
  MEMBER_PROFILE_UPDATED,
  MEMBER_REGISTERED,
  type MemberDeactivatedPayload,
  type MemberProfileUpdatedPayload,
  type MemberRegisteredPayload,
} from './events'
export { registerMember, type RegisterMemberInput } from './application/register-member'
export { updateMember, type UpdateMemberInput } from './application/update-member'
export { deactivateMember } from './application/deactivate-member'
export type { MemberRepository, MembersDeps } from './application/ports'
export { FirestoreMemberRepository } from './infrastructure/member-repo'
