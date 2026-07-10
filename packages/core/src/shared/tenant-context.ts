import type { ActorRef } from './actor'
import type { BranchId, StudioId } from './ids'

export type StaffRole = 'owner' | 'receptionist' | 'trainer'

// Constructed server-side from verified auth claims — never by a caller, never
// from client input (D6, Doc 1 §8). Repositories build tenant-scoped paths from
// this context; a repository that accepts a raw path is a defect.
export interface TenantContext {
  readonly studioId: StudioId
  readonly branchIds: readonly BranchId[]
  readonly role: StaffRole
  readonly actor: ActorRef
}

export const canAccessBranch = (ctx: TenantContext, branchId: BranchId): boolean =>
  ctx.branchIds.includes(branchId)
