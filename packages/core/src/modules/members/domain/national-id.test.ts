import { describe, expect, it } from 'vitest'

import { instant, type CorrelationId, type MemberId, type StaffUserId, type StudioId } from '../../../shared'
import { decideErase, decideSetNationalId, isValidNationalId } from './decide'
import type { Member } from './member'

// TC kimlik for the invoice (owner, 2026-11-03).
const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_owner' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
}
const VALID = '10000000146' // passes the official checksum
const member = (over: Partial<Member> = {}): Member =>
  ({ id: 'mem_1' as MemberId, studioId: 'std_1', fullName: 'Ayşe', phone: '+905551112233', phoneNormalized: '905551112233', email: null, birthDate: null, notes: null, emergencyContact: null, homeBranchId: null, status: 'active', joinedAt: instant(0), stats: {}, restriction: null, ...over }) as Member

describe('isValidNationalId', () => {
  it.each([
    [VALID, true],
    ['11111111111', false], // the placeholder is NOT a number anyone has
    ['01234567890', false], // no leading zero
    ['1000000014', false], // ten digits
    ['10000000147', false], // last digit off by one
    ['1000000014a', false],
  ])('%s → %s', (raw, want) => expect(isValidNationalId(raw)).toBe(want))
})

describe('decideSetNationalId', () => {
  it('stores a valid number, spaces stripped, and logs only the field NAME', () => {
    const r = decideSetNationalId(ctx, member(), '100 000 001 46')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.nationalId).toBe(VALID)
    expect(r.value.events[0]?.payload).toEqual({ changedFields: ['nationalId'] })
    expect(JSON.stringify(r.value.events)).not.toContain(VALID)
  })

  it('refuses a number that fails the checksum', () => {
    expect(decideSetNationalId(ctx, member(), '10000000147')).toEqual({ ok: false, error: { code: 'national_id_invalid' } })
  })

  it('null clears it; clearing nothing emits nothing', () => {
    const r = decideSetNationalId(ctx, member({ nationalId: VALID }), null)
    expect(r.ok && 'nationalId' in r.value.next).toBe(false)
    const none = decideSetNationalId(ctx, member(), null)
    expect(none.ok && none.value.events).toEqual([])
  })

  it('erasure forgets it', () => {
    const ctxAdmin = { ...ctx, actor: { type: 'platform_admin' as const, id: 'usr_admin' as StaffUserId } }
    const r = decideErase(ctxAdmin, member({ nationalId: VALID }), 'member_request' as never, null)
    expect(r.ok && 'nationalId' in r.value.next).toBe(false)
  })
})
