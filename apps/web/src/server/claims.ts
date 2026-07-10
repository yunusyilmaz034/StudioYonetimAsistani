import type {
  ActorRef,
  BranchId,
  StaffRole,
  StaffUserId,
  StudioId,
  TenantContext,
} from '@studio/core'

// The custom claims carried on a staff member's Firebase token. Owner and
// reception are the Phase 1 studio roles; `platformAdmin` is a separate capability
// flag (Doc 1 §8), not a studio role. Trainer/member auth is out of Phase 1.
//
// Pure: this file imports only the shared kernel — no Firebase, no Next — so it is
// unit-testable in milliseconds.
export interface StaffClaims {
  readonly uid: StaffUserId
  readonly studioId: StudioId
  readonly role: StaffRole
  readonly branchIds: readonly BranchId[]
  readonly platformAdmin: boolean
}

// The guard vocabulary: a studio role, or the cross-tenant platform_admin flag.
export type GuardRole = StaffRole | 'platform_admin'

const STAFF_ROLES: readonly StaffRole[] = ['owner', 'receptionist', 'trainer']

function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

// Parse and validate a decoded token into StaffClaims, or null if it is not a
// valid staff principal. Never trusts shape — this is a boundary (Doc 6 §8).
export function parseStaffClaims(
  uid: string,
  raw: Record<string, unknown>,
): StaffClaims | null {
  const { studioId, role, branchIds, platformAdmin } = raw
  if (typeof studioId !== 'string' || studioId.length === 0) return null
  if (!isStaffRole(role)) return null
  if (!isStringArray(branchIds)) return null
  return {
    uid: uid as StaffUserId,
    studioId: studioId as StudioId,
    role,
    branchIds: branchIds as BranchId[],
    platformAdmin: platformAdmin === true,
  }
}

function toActor(claims: StaffClaims): ActorRef {
  if (claims.platformAdmin) {
    return { type: 'platform_admin', id: claims.uid }
  }
  switch (claims.role) {
    case 'owner':
      return { type: 'owner', id: claims.uid }
    case 'receptionist':
      return { type: 'receptionist', id: claims.uid }
    case 'trainer':
      return { type: 'trainer', id: claims.uid }
    default: {
      const exhaustive: never = claims.role
      return exhaustive
    }
  }
}

export function claimsToTenantContext(claims: StaffClaims): TenantContext {
  return {
    studioId: claims.studioId,
    branchIds: claims.branchIds,
    role: claims.role,
    actor: toActor(claims),
  }
}

export function effectiveRoles(claims: StaffClaims): readonly GuardRole[] {
  return claims.platformAdmin ? [claims.role, 'platform_admin'] : [claims.role]
}

export function isAuthorized(
  claims: StaffClaims,
  allowed: readonly GuardRole[],
): boolean {
  return effectiveRoles(claims).some((r) => allowed.includes(r))
}
