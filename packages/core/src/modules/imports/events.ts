import type { ImportKind } from './domain/types'

// Import events (owner, 2026-07-30). An import is a BATCH: one file, one operator, one moment, and
// everything it created carries its id. That id is what makes the whole thing reversible.
//
// ── No PII, and it costs nothing to keep it that way (#6, I-13) ─────────────────────────────
//
// These payloads carry COUNTS and IDS — never a name, a phone, or an e-mail. Who was imported is
// already recorded, honestly and once, by the `member.registered` events the import writes; those
// carry the batch id too, so "which members came from this file?" is a query, not a duplicate copy
// of the file inside the log. Copying the roster in here would put the same PII in two places and
// double the work of an erasure request for no answer we could not already give.
//
// ── Why `import.reverted` and not a deletion ────────────────────────────────────────────────
//
// A mis-imported batch is undone by compensating events, like every other correction in this system
// (#9). The members and packages it created are deactivated and cancelled, the log grows, and six
// months later "where did this member come from, and what happened to her?" still has an answer.
// Restoring a Firestore backup would answer the same question by erasing every real thing that
// happened since the import — reservations, check-ins, payments — which is a larger accident than
// the one being fixed.

export const IMPORT_APPLIED = 'import.applied'
export const IMPORT_REVERTED = 'import.reverted'

export type ImportAppliedPayload = {
  readonly batchId: string
  readonly kind: ImportKind
  /** Rows the file contained, after the header. The denominator for everything below. */
  readonly rowCount: number
  readonly createdMembers: number
  readonly createdEntitlements: number
  /** Rows deliberately not imported — rejected in validation or unmatched and skipped by the operator. */
  readonly skipped: number
}

export type ImportRevertedPayload = {
  readonly batchId: string
  /** Free text, required by the domain — a reversal with no stated reason is unexplainable later. */
  readonly reason: string
  readonly revertedMembers: number
  readonly revertedEntitlements: number
}
