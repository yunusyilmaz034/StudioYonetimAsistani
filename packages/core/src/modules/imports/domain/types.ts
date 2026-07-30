import type { Instant, MemberId, ProductId } from '../../../shared'

/** What a batch brought in. A third kind (the catalogue) is a new entry here, not a new screen. */
export type ImportKind = 'members' | 'member_packages'

export type ImportBatchStatus = 'applied' | 'reverted'

/**
 * One import: one file, one operator, one moment.
 *
 * `createdMemberIds` / `createdEntitlementIds` are what makes the batch reversible — the reversal
 * needs to know exactly what to undo, and reconstructing that from the log by timestamp would catch
 * whatever else happened in the same second.
 */
export interface ImportBatch {
  readonly id: string
  readonly kind: ImportKind
  readonly fileName: string
  readonly rowCount: number
  readonly createdMemberIds: readonly MemberId[]
  readonly createdEntitlementIds: readonly string[]
  readonly skipped: number
  readonly status: ImportBatchStatus
  readonly appliedAt: Instant
  readonly revertedAt: Instant | null
}

// ── WHAT A ROW BECOMES ──────────────────────────────────────────────────────────────────────
//
// Deliberately separate from `MemberImportRow` (the BulutGym CSV shape): that one describes a
// specific vendor's export, this one describes what the wizard produces after the operator has
// mapped columns and filled the gaps. The vendor adapter can change without touching any of this.

export interface MemberDraft {
  readonly line: number
  readonly fullName: string
  readonly phoneRaw: string
  readonly email: string | null
  readonly birthDate: string | null
  readonly notes: string | null
}

export interface PackageDraft {
  readonly line: number
  /** Whose package this is. Resolved in the matching step — never guessed at apply time. */
  readonly memberId: MemberId | null
  /** Only when `memberId` is null: the member this row will create. */
  readonly newMember: MemberDraft | null
  readonly productId: ProductId
  /** Credits LEFT, not the package's size. The package keeps its own size (OR-9). */
  readonly remainingCredits: number | null
  readonly validFrom: Instant
  readonly validUntil: Instant
  readonly note: string | null
}
