import { describe, expect, it } from 'vitest'

import {
  decideDeactivate,
  decideErase,
  decideIssueInvite,
  decidePortalActivated,
  decidePortalLogin,
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
import erased from './member.erased.v1.json'
import registered from './member.registered.v1.json'
import profileUpdated from './member.profile_updated.v1.json'
import deactivated from './member.deactivated.v1.json'
import invited from './member.invited.v1.json'
import portalActivated from './member.portal_activated.v1.json'
import portalLogin from './member.portal_login.v1.json'

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

// v1.21 — the portal. Three new event TYPES (additive; no existing payload changes, so no
// upcaster is needed here).
describe('portal event payloads (v1.21)', () => {
  const memberCtx = {
    ...ctx,
    actor: { type: 'member' as const, id: 'mem_1' as MemberId },
  }

  it('member.invited — carries the expiry and NEVER the token', () => {
    const r = decideIssueInvite(ctx, member, instant(1_000_000))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value[0]?.payload).toEqual(invited)
      // A bearer credential in an immutable log would be unrecoverable. It is not there.
      expect(JSON.stringify(r.value[0]?.payload)).not.toContain('token')
    }
  })

  it('refuses an invite for an inactive member', () => {
    const r = decideIssueInvite(ctx, { ...member, status: 'inactive' }, instant(1_000_000))
    expect(r).toEqual({ ok: false, error: { code: 'member_not_active' } })
  })

  it('member.portal_activated — actor is the MEMBER, not the receptionist', () => {
    const e = decidePortalActivated(memberCtx, member)[0]
    expect(e?.payload).toEqual(portalActivated)
    expect(e?.actor).toEqual({ type: 'member', id: 'mem_1' })
  })

  it('member.portal_login — attributable to her (non-negotiable #5)', () => {
    const e = decidePortalLogin(memberCtx, member)[0]
    expect(e?.payload).toEqual(portalLogin)
    expect(e?.actor).toEqual({ type: 'member', id: 'mem_1' })
    expect(e?.related).toEqual({ memberId: 'mem_1' })
  })

  // ── v1.26 · AD-67 — KVKK erasure ─────────────────────────────────────────────────────────
  const adminCtx = { ...ctx, actor: { type: 'platform_admin' as const, id: 'usr_admin' as never } }

  it('member.erased — the payload carries an OPAQUE id, a closed-enum reason, and nothing else', () => {
    const r = decideErase(adminCtx, member, 'kvkk_request', 'avukatı aradı')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.value.events[0]?.payload).toEqual(erased)

    // The golden fixture is the contract, and this is the assertion it exists for: an AI agent that
    // "helpfully" adds a name to this payload breaks the build, not the law.
    const json = JSON.stringify(r.value.events[0]?.payload)
    expect(json).not.toContain(member.fullName)
    expect(json).not.toContain(member.phone)
    expect(json).not.toContain('avukat') // the human's note lives on the tombstone, never in the log
  })

  it('erases every string that could identify her — including the phone UNIQUENESS KEY', () => {
    const r = decideErase(adminCtx, member, 'kvkk_request', null)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.value.next.fullName).toBe('[silindi]')
    expect(r.value.next.email).toBeNull()
    expect(r.value.next.notes).toBeNull()
    expect(r.value.next.emergencyContact).toBeNull()
    // Leaving this would keep her number in the index — the precise thing she asked us to forget.
    expect(r.value.next.phoneNormalized).toBe('')
    expect(r.value.next.erased?.reason).toBe('kvkk_request')
  })

  it('REFUSES anyone who is not a platform_admin — erasure is break-glass, not an operation', () => {
    // Reception must not be able to make a member disappear. Nor must the owner, mid-argument.
    const r = decideErase(ctx, member, 'kvkk_request', null)
    expect(r).toEqual({ ok: false, error: { code: 'erasure_requires_platform_admin' } })
  })

  it('is IDEMPOTENT — a second erasure emits no event', () => {
    const first = decideErase(adminCtx, member, 'kvkk_request', null)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // She was already forgotten. Saying so twice adds nothing to the record, and would make an audit
    // read as two separate acts. Re-running a break-glass script because its output scrolled away
    // must be safe.
    const second = decideErase(adminCtx, first.value.next, 'kvkk_request', null)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.events).toEqual([])
  })
})
