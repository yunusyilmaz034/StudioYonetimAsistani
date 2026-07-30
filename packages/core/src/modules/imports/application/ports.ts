import type { Clock, MemberId } from '../../../shared'
import type { TenantContext } from '../../../shared'
import type { ImportBatch } from '../domain/types'

// The batch store, as a port.
//
// `openBatch` is called BEFORE anything is created and `recordCreated` after each record, not once
// at the end. Seventy members cannot be one transaction, so a failure part-way leaves a partial
// batch — and recording the ids at the end would mean a crash in row forty leaves thirty-nine
// members in the studio with no record that they came from an import: orphans nobody can find, let
// alone undo.
export interface ImportBatchRepository {
  open(ctx: TenantContext, batch: ImportBatch, appliedBy: string): Promise<void>
  recordCreated(
    ctx: TenantContext,
    batchId: string,
    created: { memberId?: MemberId; entitlementId?: string },
  ): Promise<void>
  close(ctx: TenantContext, batchId: string, skipped: number): Promise<void>
  get(ctx: TenantContext, batchId: string): Promise<ImportBatch | null>
  markReverted(ctx: TenantContext, batchId: string, at: number, reason: string): Promise<void>
  list(ctx: TenantContext, limit: number): Promise<readonly ImportBatch[]>
}

/** Just enough of the catalogue to grant a package. Supplied by the caller, not read from here. */
export interface ImportsDeps {
  readonly batches: ImportBatchRepository
  readonly clock: Clock
}
