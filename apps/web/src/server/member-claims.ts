import type { ActorRef, MemberId, StudioId, TenantContext } from '@studio/core'

// D11 (v1.21) — the member principal's claims, kept deliberately apart from `StaffClaims`.
//
// They are NOT the same shape with a different role string, and the split is the point:
// `parseStaffClaims` REFUSES a member token (it only accepts owner/receptionist/trainer), and
// `parseMemberClaims` refuses a staff one. So a member token can never satisfy a staff guard by
// accident, and a staff token can never be mistaken for a member's — which matters because
// `memberId` is what every portal read is scoped by.
//
// Pure: this file imports only the shared kernel — no Firebase, no Next — so it is
// unit-testable in milliseconds.
export interface MemberClaims {
  readonly uid: string // the Firebase Auth uid — NOT the memberId
  readonly studioId: StudioId
  readonly memberId: MemberId
}

// Parse and validate a decoded token into MemberClaims, or null if it is not a valid member
// principal. Never trusts shape — this is a boundary (Doc 6 §8).
//
// `uid !== memberId` on purpose: the Firebase user is an auth artefact, the member is a
// business object. Keeping them distinct also means a member can never satisfy the /commands
// rule (`actor.id == request.auth.uid`), which is exactly the outcome the perimeter wants.
export function parseMemberClaims(uid: string, raw: Record<string, unknown>): MemberClaims | null {
  const { studioId, role, memberId } = raw
  if (role !== 'member') return null
  if (typeof studioId !== 'string' || studioId.length === 0) return null
  if (typeof memberId !== 'string' || memberId.length === 0) return null
  return {
    uid,
    studioId: studioId as StudioId,
    memberId: memberId as MemberId,
  }
}

export function memberActor(claims: MemberClaims): ActorRef {
  return { type: 'member', id: claims.memberId }
}

// The tenant context a portal read/write runs under. `branchIds` is empty: a member is not
// branch-scoped staff, and no member operation is authorised by branch.
//
// Every event a member causes is attributed to HER — `actor: { type: 'member', … }` — never to
// the receptionist who wasn't there (non-negotiable #5).
export function memberClaimsToTenantContext(claims: MemberClaims): TenantContext {
  return {
    studioId: claims.studioId,
    branchIds: [],
    role: 'member',
    actor: memberActor(claims),
  }
}
