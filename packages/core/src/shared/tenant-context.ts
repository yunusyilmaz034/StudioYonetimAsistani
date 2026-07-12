import type { ActorRef } from './actor'
import type { BranchId, StudioId } from './ids'

export type StaffRole = 'owner' | 'receptionist' | 'trainer'

// D11 (v1.21) — a member is a principal too. She never reaches a staff Server Action
// (`requireTenantContext` only ever accepts staff roles + platform_admin), and she has NO
// client-SDK read access at all (firestore.rules). What she does get is a context whose
// `studioId` and `memberId` come from a VERIFIED session cookie — never from a request body.
export type PrincipalRole = StaffRole | 'member'

// Constructed server-side from verified auth claims — never by a caller, never
// from client input (D6, Doc 1 §8). Repositories build tenant-scoped paths from
// this context; a repository that accepts a raw path is a defect.
export interface TenantContext {
  readonly studioId: StudioId
  readonly branchIds: readonly BranchId[]
  readonly role: PrincipalRole
  readonly actor: ActorRef
}

export const canAccessBranch = (ctx: TenantContext, branchId: BranchId): boolean =>
  ctx.branchIds.includes(branchId)
