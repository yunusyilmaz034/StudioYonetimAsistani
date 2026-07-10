import { describe, expect, it } from 'vitest'

import {
  decideDeactivate,
  decideRegisterMember,
  decideUpdateProfile,
} from '../../src/modules/members/domain/decide'
import { emptyStats, type Member, type PhoneE164 } from '../../src/modules/members/domain/member'
import {
  instant,
  type BranchId,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import registered from './member.registered.v1.json'
import profileUpdated from './member.profile_updated.v1.json'
import deactivated from './member.deactivated.v1.json'

// Golden fixtures (AD-33): the committed payload contract per event type. A change
// to a payload shape fails here, forcing an explicit version bump + upcaster.

const now = instant(1_700_000_000_000)
const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist' as const, id: 'usr_1' as StaffUserId },
  now,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const member: Member = {
  id: 'mem_1' as MemberId,
  studioId: 'std_1' as StudioId,
  homeBranchId: 'brn_demo' as BranchId,
  fullName: 'Ayşe Yılmaz',
  phone: '+905321234567' as PhoneE164,
  phoneNormalized: '905321234567',
  email: null,
  birthDate: null,
  notes: null,
  emergencyContact: null,
  status: 'active',
  joinedAt: now,
  stats: emptyStats(),
}

describe('member event payloads match golden fixtures', () => {
  it('member.registered', () => {
    expect(decideRegisterMember(ctx, member)[0]?.payload).toEqual(registered)
  })

  it('member.profile_updated', () => {
    const next: Member = {
      ...member,
      fullName: 'Ayşe Kaya',
      phone: '+905329999999' as PhoneE164,
      phoneNormalized: '905329999999',
    }
    expect(decideUpdateProfile(ctx, member, next)[0]?.payload).toEqual(profileUpdated)
  })

  it('member.deactivated', () => {
    const r = decideDeactivate(ctx, member, 'Üye ayrıldı')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(deactivated)
  })
})
