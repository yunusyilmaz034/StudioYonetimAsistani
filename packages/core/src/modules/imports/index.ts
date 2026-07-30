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
  ProductCandidate,
} from './domain/types'
export * from './events'
export { fieldsFor, MEMBER_FIELDS, PACKAGE_FIELDS } from './domain/fields'
// Cell → domain value. Every one of these returns null rather than guessing.
export { parseBirthDate, parseCount, parseDate } from './domain/parse'
export { cellFor, foldHeader, foldLabel, suggestMapping, type FieldSpec } from './domain/headers'
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
  type RejectedRow,
} from './domain/build'
// The file's package labels are not our package names — the operator maps them, once each.
export {
  foldAliases,
  suggestProducts,
  unknownLabels,
  type ProductShape,
  type ProductSuggestion,
} from './domain/product-alias'
// Undo, and the line that keeps it safe.
export {
  decideRevert,
  type EntitlementActivity,
  type MemberActivity,
  type RevertBlocker,
  type RevertVerdict,
} from './domain/revert'

// Application: the only part that writes, and the reversal that undoes it.
export {
  applyImport,
  revertImport,
  type ApplyImportInput,
  type ApplyImportResult,
  type ImportFailure,
  type ImportModuleDeps,
  type ImportProduct,
  type Resolution,
  type RevertImportResult,
} from './application/apply'
export type { ImportBatchRepository, ImportsDeps } from './application/ports'
export { FirestoreImportBatchRepository } from './infrastructure/repos'
