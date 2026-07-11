import type { BranchId, Clock, Instant, MemberId, NewEvent, TenantContext } from '../../../shared'
import type { BranchOccupancy, CheckIn, Presence } from '../domain/types'

// Admin SDK only (AD-15). The check-in state lives in three shapes: the append-style
// `/checkIns` log, the `/presence/{memberId}` toggle docs (existence ⇔ inside), and
// the branch occupancy window.
export interface CheckinRepository {
  getBranch(ctx: TenantContext, branchId: BranchId): Promise<BranchOccupancy | null>
  saveBranch(ctx: TenantContext, branch: BranchOccupancy, events: readonly NewEvent[]): Promise<void>

  getPresence(ctx: TenantContext, memberId: MemberId): Promise<Presence | null>
  countPresence(ctx: TenantContext, branchId: BranchId): Promise<number>
  listPresence(ctx: TenantContext, branchId: BranchId): Promise<readonly Presence[]>
  listStalePresence(ctx: TenantContext, checkedInBefore: Instant): Promise<readonly Presence[]>
  // Dashboard (v1.16): the branch's check-ins since a day boundary (the log read).
  listCheckInsForDay(ctx: TenantContext, branchId: BranchId, since: Instant): Promise<readonly CheckIn[]>
  // Member Workspace (v1.18): one member's check-in history since a bound, newest first.
  listCheckInsByMember(ctx: TenantContext, memberId: MemberId, since: Instant): Promise<readonly CheckIn[]>

  // One transaction: write the CheckIn record, set-or-delete the presence doc, append
  // the events (non-negotiable #1).
  applyCheckIn(
    ctx: TenantContext,
    memberId: MemberId,
    checkIn: CheckIn,
    presenceNext: Presence | null,
    events: readonly NewEvent[],
  ): Promise<void>

  // Auto-check-out: delete the presence doc + append the event.
  applyAutoCheckOut(ctx: TenantContext, memberId: MemberId, events: readonly NewEvent[]): Promise<void>
}

export interface CheckinDeps {
  readonly repo: CheckinRepository
  readonly clock: Clock
}
