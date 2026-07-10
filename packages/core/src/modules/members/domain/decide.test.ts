import { describe, expect, it } from 'vitest'

import {
  instant,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import { decideDeactivate, decideRegisterMember, decideUpdateProfile } from './decide'
import type { DecideContext } from './decide'
import { emptyStats, type Member, type PhoneE164 } from './member'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'mem_1' as MemberId,
    studioId: 'std_1' as StudioId,
    homeBranchId: null,
    fullName: 'Ayşe Yılmaz',
    phone: '+905321234567' as PhoneE164,
    phoneNormalized: '905321234567',
    email: null,
    birthDate: null,
    notes: null,
    emergencyContact: null,
    status: 'active',
    joinedAt: instant(1_700_000_000_000),
    stats: emptyStats(),
    ...overrides,
  }
}

describe('decideRegisterMember', () => {
  it('emits member.registered with no PII in the payload', () => {
    const events = decideRegisterMember(ctx, makeMember())
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('member.registered')
    expect(JSON.stringify(events[0]?.payload)).not.toContain('Ayşe')
    expect(events[0]?.related.memberId).toBe('mem_1')
  })
})

describe('decideUpdateProfile', () => {
  it('emits nothing when nothing changed', () => {
    const m = makeMember()
    expect(decideUpdateProfile(ctx, m, m)).toHaveLength(0)
  })

  it('records changed field NAMES only, never values (AD-25)', () => {
    const before = makeMember()
    const after = makeMember({ fullName: 'Ayşe Kaya' })
    const events = decideUpdateProfile(ctx, before, after)
    expect(events).toHaveLength(1)
    expect(events[0]?.payload.changedFields).toEqual(['fullName'])
    expect(JSON.stringify(events[0]?.payload)).not.toContain('Kaya')
  })
})

describe('decideDeactivate', () => {
  it('emits member.deactivated for an active member', () => {
    const r = decideDeactivate(ctx, makeMember(), 'Üye ayrıldı')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.type).toBe('member.deactivated')
  })

  it('refuses an empty reason (AD-22)', () => {
    const r = decideDeactivate(ctx, makeMember(), '   ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('reason_required')
  })

  it('is idempotent on an already-inactive member', () => {
    const r = decideDeactivate(ctx, makeMember({ status: 'inactive' }), 'x')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toHaveLength(0)
  })
})
