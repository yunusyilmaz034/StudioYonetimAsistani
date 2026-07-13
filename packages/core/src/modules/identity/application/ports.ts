import type { Clock, NewEvent, StaffUserId, TenantContext } from '../../../shared'
import type { StaffMember } from '../domain/types'

// Admin SDK only (AD-15). Staff are written by the owner, from the product — and, exactly once per
// studio, by a break-glass bootstrap script, because somebody has to be able to log in first.
export interface IdentityRepository {
  listStaff(ctx: TenantContext): Promise<readonly StaffMember[]>
  getStaff(ctx: TenantContext, id: StaffUserId): Promise<StaffMember | null>

  /** The staff document and its event commit TOGETHER (#1). If they could drift, the audit is
   *  decorative — and the audit is the only reason these are events at all. */
  saveStaff(ctx: TenantContext, staff: StaffMember, events: readonly NewEvent[]): Promise<void>
}

export interface IdentityDeps {
  readonly repo: IdentityRepository
  readonly clock: Clock
}
