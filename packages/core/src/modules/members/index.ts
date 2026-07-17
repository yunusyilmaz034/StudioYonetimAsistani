// The members module's only public door (AD-29).
export type {
  Email,
  EmergencyContact,
  Member,
  MemberRestriction,
  MembershipStatus,
  MemberSnapshot,
  MemberStats,
  MemberStatus,
  PhoneE164,
} from './domain/member'
export { toMemberSnapshot } from './domain/member'
export { decideSetRestriction, decideClearRestriction } from './domain/decide'
export { setMemberRestriction, clearMemberRestriction } from './application/restriction'
export {
  MEMBER_RESTRICTION_CLEARED,
  MEMBER_RESTRICTION_SET,
  RestrictionReasons,
  type MemberRestrictionClearedPayload,
  type MemberRestrictionSetPayload,
  type RestrictionReason,
} from './events'
export { normalizePhone, type NormalizedPhone } from './domain/phone'
export {
  MEMBER_DEACTIVATED,
  MEMBER_PROFILE_UPDATED,
  MEMBER_REGISTERED,
  type MemberDeactivatedPayload,
  type MemberProfileUpdatedPayload,
  type MemberRegisteredPayload,
} from './events'
// v1.28 — the signed-document archive.
export type { MemberDocument } from './domain/document'
export {
  DocumentKinds,
  MEMBER_DOCUMENT_ADDED,
  MEMBER_DOCUMENT_REMOVED,
  type DocumentKind,
  type MemberDocumentAddedPayload,
  type MemberDocumentRemovedPayload,
} from './events'
export { addMemberDocument, listMemberDocuments, removeMemberDocument } from './application/documents'
export { registerMember, type RegisterMemberInput } from './application/register-member'
export { updateMember, type UpdateMemberInput } from './application/update-member'
export { deactivateMember } from './application/deactivate-member'
export { eraseMember } from './application/erase-member'
export { FirestorePiiPurger, type PurgePlan } from './infrastructure/purge'
export { ErasureReasons, MEMBER_ERASED, type ErasureReason, type MemberErasedPayload } from './events'
// v1.21 — the portal invite (D1/D2/D17).
export {
  completeActivation,
  issueMemberInvite,
  recordPortalLogin,
  resolveInvite,
} from './application/invite'
export { checkInviteUsable, INVITE_TTL_HOURS, type MemberInvite, type InviteStatus } from './domain/invite'
export type { MemberEventRecord, MemberRepository, MembersDeps } from './application/ports'
export { FirestoreMemberRepository } from './infrastructure/member-repo'

// v1.27 S5 — the BulutGym import: the PURE rules that decide what may enter production.
// One implementation, two callers: `tools/migration` (break-glass) and the owner's import screen.
export {
  isClean,
  REJECTION_COPY,
  validateMembers,
  type MemberImportRow,
  type Rejection,
  type RejectionReason,
  type ValidationReport,
  type ValidMember,
} from './domain/import'
export { MissingColumnError, readBulutGymMembers } from './domain/import-csv'
