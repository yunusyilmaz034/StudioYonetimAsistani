// The rules moved into the domain (v1.27 S5), because the owner's import screen must run EXACTLY
// them — two validators are two answers to "may this row enter production?", and one of them is
// wrong. This file is now a door, not an implementation.
export {
  isClean,
  REJECTION_COPY,
  validateMembers,
  type MemberImportRow,
  type Rejection,
  type RejectionReason,
  type ValidationReport,
  type ValidMember,
} from '@studio/core'
