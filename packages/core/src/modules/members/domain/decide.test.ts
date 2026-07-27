import { describe, expect, it } from 'vitest'

import {
  instant,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import { decideDeactivate, decideRegisterMember, decideRequestDeletion, decideUpdateProfile } from './decide'
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
    restriction: null,
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

// ── "Hesabımı sil" (App Store 5.1.1(v), 2026-07-27) ──────────────────────────────────────────
//
// The line this test defends: a member may end her ACCESS, never the studio's records. Erasure stays
// break-glass (AD-67) because her payments and invoices carry a statutory retention period.
describe('decideRequestDeletion', () => {
  const member = () => makeMember()

  it('records the request and marks the member', () => {
    const r = decideRequestDeletion(ctx, member(), 'member_app')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.events.map((e) => e.type)).toEqual(['member.deletion_requested'])
      expect(r.value.next.deletionRequestedAt).toBe(ctx.now)
    }
  })

  it('puts NO PII in the event — only where she asked from', () => {
    const r = decideRequestDeletion(ctx, member(), 'member_app')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload).toEqual({ source: 'member_app' })
  })

  // She does NOT become erased, and nothing about her record is destroyed here. If this ever starts
  // wiping fields, a member will have deleted the studio's accounting records from a phone.
  it('does not erase anything', () => {
    const before = member()
    const r = decideRequestDeletion(ctx, before, 'member_portal')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.fullName).toBe(before.fullName)
      expect(r.value.next.phone).toBe(before.phone)
      expect(r.value.next.erased).toBeUndefined()
    }
  })

  // A second tap — a dismissed screen, an anxious member, a retried request — is ONE request. Two
  // events would make an audit read as two separate acts.
  it('is idempotent: asking twice writes one event', () => {
    const first = decideRequestDeletion(ctx, member(), 'member_app')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = decideRequestDeletion(ctx, first.value.next, 'member_app')
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.value.events).toHaveLength(0)
  })

  it('says nothing for a member who was already erased', () => {
    const gone = makeMember({ erased: { at: ctx.now, reason: 'kvkk_request', note: null } })
    const r = decideRequestDeletion(ctx, gone, 'member_app')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events).toHaveLength(0)
  })
})
