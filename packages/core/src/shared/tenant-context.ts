import type { ActorRef } from './actor'
import type { BranchId, StudioId } from './ids'

// The `kiosk` role is a wall-mounted self-service tablet, not a person: it may reach the QR check-in
// kiosk and nothing else — never a member, the till, or the settings. It is the studio's LEAST
// privileged principal. What it RECORDS is attributed to a `device` actor (claims.ts · toActor),
// never a human's identity (non-negotiable #5) — the tablet is not reception wearing a costume.
export type StaffRole = 'owner' | 'receptionist' | 'trainer' | 'kiosk'

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
