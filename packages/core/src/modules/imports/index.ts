// The imports module's only public door (AD-29).
//
// An import is a BATCH: one file, one operator, one moment, and everything it created carries its
// id. That id is what makes it reversible — and the reversal is compensating events scoped to the
// batch, never a deletion and never a database restore. See `domain/revert.ts` for why.
export type {
  ImportBatch,
  ImportBatchStatus,
  ImportKind,
  MemberDraft,
  PackageDraft,
} from './domain/types'
export * from './events'
export { fieldsFor, MEMBER_FIELDS, PACKAGE_FIELDS } from './domain/fields'
// Cell → domain value. Every one of these returns null rather than guessing.
export { parseBirthDate, parseCount, parseDate } from './domain/parse'
export { cellFor, foldHeader, suggestMapping, type FieldSpec } from './domain/headers'
// Matching: a phone is certain, a name is only ever a proposal.
export {
  foldName,
  isAmbiguous,
  matchMember,
  type MatchCandidate,
  type MatchOutcome,
  type NameProposal,
} from './domain/match'
// Rows → what would happen. What the preview screen renders; writes nothing.
export {
  buildMembers,
  buildPackages,
  missingRequired,
  needsDecision,
  toPackageDraft,
  type BuildMembersResult,
  type BuildPackagesResult,
  type Defaults,
  type Mapping,
  type MemberRow,
  type NormalizePhone,
  type PackageRow,
  type ProductCandidate,
  type RejectedRow,
} from './domain/build'
// Undo, and the line that keeps it safe.
export {
  decideRevert,
  type EntitlementActivity,
  type MemberActivity,
  type RevertBlocker,
  type RevertVerdict,
} from './domain/revert'
