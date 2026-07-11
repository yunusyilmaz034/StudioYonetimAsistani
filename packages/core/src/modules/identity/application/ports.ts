import type { TenantContext } from '../../../shared'
import type { StaffMember } from '../domain/types'

// Read-only in Phase 1 (staff writes are a later milestone). Admin SDK only (AD-15).
export interface IdentityRepository {
  listStaff(ctx: TenantContext): Promise<readonly StaffMember[]>
}

export interface IdentityDeps {
  readonly repo: IdentityRepository
}
