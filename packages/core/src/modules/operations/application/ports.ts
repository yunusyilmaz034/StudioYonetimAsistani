import type { Clock, NewEvent, TenantContext } from '../../../shared'
import type { BulkOperation, StudioClosure } from '../domain/types'

export interface OperationsRepository {
  getClosure(ctx: TenantContext, id: string): Promise<StudioClosure | null>
  listClosures(ctx: TenantContext): Promise<readonly StudioClosure[]>
  saveClosure(ctx: TenantContext, c: StudioClosure, events: readonly NewEvent[]): Promise<void>
  // Status-only writes during the apply run (planned → applying → applied). Kept separate so a
  // worker can advance the progress ledger without rewriting the whole aggregate.
  setClosureStatus(ctx: TenantContext, id: string, status: StudioClosure['status']): Promise<void>

  getBulk(ctx: TenantContext, id: string): Promise<BulkOperation | null>
  listBulk(ctx: TenantContext): Promise<readonly BulkOperation[]>
  saveBulk(ctx: TenantContext, b: BulkOperation, events: readonly NewEvent[]): Promise<void>
  setBulkStatus(ctx: TenantContext, id: string, status: BulkOperation['status']): Promise<void>
}

export interface OperationsDeps {
  readonly repo: OperationsRepository
  readonly clock: Clock
}
