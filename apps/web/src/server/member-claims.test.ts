import { describe, expect, it } from 'vitest'

import { parseStaffClaims } from './claims'
import { memberClaimsToTenantContext, parseMemberClaims } from './member-claims'

// D11 — the two parsers must refuse each other's tokens. This is the boundary that makes a
// member unable to reach a staff Server Action, and a staff token unable to masquerade as a
// member (whose `memberId` scopes every portal read).

const MEMBER = { studioId: 'std_1', role: 'member', memberId: 'mem_1' }
const STAFF = { studioId: 'std_1', role: 'receptionist', branchIds: ['brn_1'] }

describe('parseMemberClaims', () => {
  it('accepts a valid member token', () => {
    expect(parseMemberClaims('uid_1', MEMBER)).toEqual({
      uid: 'uid_1',
      studioId: 'std_1',
      memberId: 'mem_1',
    })
  })

  it('REFUSES a staff token — a receptionist is not a member', () => {
    expect(parseMemberClaims('uid_1', STAFF)).toBeNull()
  })

  it('refuses a token with role member but no memberId — there is nothing to scope reads by', () => {
    expect(parseMemberClaims('uid_1', { studioId: 'std_1', role: 'member' })).toBeNull()
    expect(parseMemberClaims('uid_1', { studioId: 'std_1', role: 'member', memberId: '' })).toBeNull()
  })

  it('refuses a member token with no studio', () => {
    expect(parseMemberClaims('uid_1', { role: 'member', memberId: 'mem_1' })).toBeNull()
  })
})

describe('parseStaffClaims (the other side of the boundary)', () => {
  it('REFUSES a member token — she can never satisfy a staff guard', () => {
    expect(parseStaffClaims('uid_1', MEMBER)).toBeNull()
  })
})

describe('memberClaimsToTenantContext', () => {
  it('scopes to the studio, carries the member actor, and claims no branch', () => {
    const ctx = memberClaimsToTenantContext({
      uid: 'uid_1',
      studioId: 'std_1' as never,
      memberId: 'mem_1' as never,
    })
    expect(ctx).toEqual({
      studioId: 'std_1',
      branchIds: [], // a member is not branch-scoped staff
      role: 'member',
      actor: { type: 'member', id: 'mem_1' }, // her events are attributed to HER (#5)
    })
  })

  it('derives the memberId from the CLAIMS — the uid is not the memberId', () => {
    const ctx = memberClaimsToTenantContext({
      uid: 'firebase_uid_xyz',
      studioId: 'std_1' as never,
      memberId: 'mem_1' as never,
    })
    // If these were conflated, a member could satisfy the /commands rule
    // (`actor.id == request.auth.uid`) and write state directly.
    expect(ctx.actor.id).toBe('mem_1')
    expect(ctx.actor.id).not.toBe('firebase_uid_xyz')
  })
})
