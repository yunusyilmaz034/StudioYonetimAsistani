import type { MemberId, TenantContext } from '@studio/core'

import {
  claimsToTenantContext,
  isAuthorized,
  parseStaffClaims,
  type GuardRole,
  type StaffClaims,
} from './claims'
import { adminAuth } from './firebase-admin'
import {
  memberClaimsToTenantContext,
  parseMemberClaims,
  type MemberClaims,
} from './member-claims'
import { readSessionCookie } from './session-cookie'

// Authorization failures are thrown, not returned as domain values — they are
// infrastructure/HTTP concerns (Doc 6 §7). A route or action catches them to
// redirect to /login (Unauthorized) or render a 403 (Forbidden).
export class UnauthorizedError extends Error {
  constructor() {
    super('Not authenticated')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(readonly required: readonly GuardRole[]) {
    super('Insufficient role')
    this.name = 'ForbiddenError'
  }
}

// Read + verify the session cookie and parse it into validated staff claims, or
// null if there is no valid session. This is THE authoritative check — it runs on
// the Node server with the Admin SDK, never in the middleware (decision #3).
export async function getVerifiedClaims(): Promise<StaffClaims | null> {
  const cookie = await readSessionCookie()
  if (!cookie) return null
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true)
    return parseStaffClaims(decoded.uid, decoded as unknown as Record<string, unknown>)
  } catch {
    return null
  }
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const claims = await getVerifiedClaims()
  return claims ? claimsToTenantContext(claims) : null
}

// ── The member principal (D11, v1.21) ────────────────────────────────────────────────────
//
// THE single door for every member-portal read and write. Two properties make the portal safe,
// and both live here rather than in any screen:
//
//   1. **`memberId` comes out of the verified session cookie — never out of a request.** There
//      is no parameter to forge, because there is no parameter. A `memberId` arriving from a
//      client is ignored everywhere in the portal.
//   2. **A staff token cannot pass through it, and a member token cannot pass through
//      `requireTenantContext`.** The two parsers refuse each other's shapes.
export class NotAMemberError extends Error {
  constructor() {
    super('Not a member principal')
    this.name = 'NotAMemberError'
  }
}

export async function getMemberClaims(): Promise<MemberClaims | null> {
  const cookie = await readSessionCookie()
  if (!cookie) return null
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true)
    return parseMemberClaims(decoded.uid, decoded as unknown as Record<string, unknown>)
  } catch {
    return null
  }
}

export interface MemberContext {
  readonly ctx: TenantContext // studio-scoped; actor = { type: 'member', id }
  readonly memberId: MemberId
}

export async function requireMemberContext(): Promise<MemberContext> {
  const claims = await getMemberClaims()
  if (!claims) throw new UnauthorizedError()
  return { ctx: memberClaimsToTenantContext(claims), memberId: claims.memberId }
}

// The single door for every trusted server-side write (AD-35). Throws
// UnauthorizedError when there is no session, ForbiddenError when the principal
// lacks an allowed role. `['owner', 'platform_admin']` is the catalogue guard
// (AD-46) — reception may read products but never write them.
export async function requireTenantContext(
  allowed: readonly GuardRole[],
): Promise<TenantContext> {
  const claims = await getVerifiedClaims()
  if (!claims) throw new UnauthorizedError()
  if (!isAuthorized(claims, allowed)) throw new ForbiddenError(allowed)
  return claimsToTenantContext(claims)
}
