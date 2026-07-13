import { describe, expect, it } from 'vitest'

import {
  decideChangeRole,
  decideCreateStaff,
  decideDeactivateStaff,
  decideReactivateStaff,
} from '../../src/modules/identity/domain/decide'
import type { StaffMember } from '../../src/modules/identity/domain/types'
import { instant, type CorrelationId, type StaffUserId, type StudioId } from '../../src/shared'
import created from './staff.created.v1.json'
import deactivated from './staff.deactivated.v1.json'
import reactivated from './staff.reactivated.v1.json'
import roleChanged from './staff.role_changed.v1.json'

// Staff — who may work here, and as what (v1.27 S1 · owner, 2026-07-13).
//
// **Granting a role is the quietest way to widen access in this system.** Making somebody a
// receptionist hands her every member's phone number and the key to the till. It costs nothing, it
// looks like an administrative chore, and it is the single act most worth being able to explain a
// year later.

const OWNER_UID = 'usr_owner' as StaffUserId
const ctx = (actorType: 'owner' | 'receptionist' = 'owner') => ({
  studioId: 'std_1' as StudioId,
  actor: { type: actorType, id: (actorType === 'owner' ? OWNER_UID : 'usr_rec') as never },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
})

const staff = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'usr_1' as StaffUserId,
  displayName: 'Deniz Kaya',
  role: 'receptionist',
  active: true,
  ...over,
})

describe('the payloads carry a role and an opaque id — never a name (#6)', () => {
  it('staff.created', () => {
    const r = decideCreateStaff(ctx(), staff(), null)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.value[0]?.payload).toEqual(created)
    // Her NAME is PII. It lives on `/staff`, where an erasure can reach it. The log keeps the id and
    // the role — the analysable part, and the part that must survive her leaving.
    expect(JSON.stringify(r.value[0]?.payload)).not.toContain('Deniz')
    expect(r.value[0]?.subject).toEqual({ kind: 'staff', id: 'usr_1' })
  })

  it('staff.role_changed carries BOTH directions', () => {
    const r = decideChangeRole(ctx(), staff(), 'trainer', 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // "Ayşe became a receptionist" does not tell you whether that widened her access or narrowed it,
    // and a year later that is the only thing anybody wants to know.
    expect(r.value.events[0]?.payload).toEqual(roleChanged)
    expect(r.value.next.role).toBe('trainer')
  })

  it('staff.deactivated carries the reason', () => {
    const r = decideDeactivateStaff(ctx(), staff(), 'İşten ayrıldı', OWNER_UID, 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual(deactivated)
    expect(r.value.next.active).toBe(false)
  })

  it('staff.reactivated', () => {
    const r = decideReactivateStaff(ctx(), staff({ active: false }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual(reactivated)
    expect(r.value.next.active).toBe(true)
  })
})

describe('only the owner decides who works here', () => {
  it('REFUSES reception — she must not be able to create an account that can', () => {
    // The case that actually matters is not self-promotion (which this also refuses); it is
    // reception quietly creating a *second* account with the owner's role.
    const r = decideCreateStaff(ctx('receptionist'), staff(), null)
    expect(r).toEqual({ ok: false, error: { code: 'staff_admin_required' } })
  })

  it('REFUSES reception changing a role', () => {
    const r = decideChangeRole(ctx('receptionist'), staff(), 'owner', 2)
    expect(r.ok).toBe(false)
  })
})

// **A studio ALWAYS has at least one active owner** (owner, 2026-07-13).
//
// She is the only principal who can administer staff. A studio whose last owner was demoted or
// deactivated has locked EVERY HUMAN out of its own permission system, and the way back is a
// developer with admin credentials running a break-glass script. The refusal costs a click; the
// recovery costs a phone call to somebody who may be on holiday.
describe('the last active owner', () => {
  const soleOwner = staff({ id: OWNER_UID, role: 'owner' })

  it('cannot be demoted — there would be nobody left who can grant a role', () => {
    const r = decideChangeRole(ctx(), soleOwner, 'trainer', 1)
    expect(r).toEqual({ ok: false, error: { code: 'last_owner_required' } })
  })

  it('cannot be deactivated', () => {
    const r = decideDeactivateStaff(ctx(), soleOwner, 'ayrıldı', 'usr_other' as StaffUserId, 1)
    expect(r).toEqual({ ok: false, error: { code: 'last_owner_required' } })
  })

  it('but an owner MAY step back once a second one exists — succession is a thing a studio does', () => {
    // The invariant is "at least one", not "you, forever". This is the case the rule must NOT break:
    // Işıl promotes her manager, then steps back to trainer herself.
    const r = decideChangeRole(ctx(), soleOwner, 'trainer', 2)
    expect(r.ok).toBe(true)
  })

  it('and deactivating a NON-owner never trips the rule, however few owners there are', () => {
    const r = decideDeactivateStaff(ctx(), staff({ role: 'trainer' }), 'ayrıldı', OWNER_UID, 1)
    expect(r.ok).toBe(true)
  })
})

describe('you cannot disable your own login', () => {
  it('refuses — you are locked out this second, and the person who can let you back in is the colleague you were about to ask', () => {
    const me = staff({ id: OWNER_UID, role: 'owner' })
    const r = decideDeactivateStaff(ctx(), me, 'x', OWNER_UID, 2)
    expect(r).toEqual({ ok: false, error: { code: 'cannot_deactivate_self' } })
  })
})

describe('a departure is explained, and a re-run is not a second hiring', () => {
  it('refuses a deactivation with no reason', () => {
    // A departure with no recorded reason is indistinguishable from an account somebody quietly
    // removed — and this is exactly the class of act an audit log exists for.
    const r = decideDeactivateStaff(ctx(), staff(), '   ', OWNER_UID, 2)
    expect(r).toEqual({ ok: false, error: { code: 'reason_required' } })
  })

  it('is IDEMPOTENT — creating an existing staff member emits nothing', () => {
    // The bootstrap script re-runs. The button gets double-clicked. Neither may make one hiring read
    // as two in the audit.
    const r = decideCreateStaff(ctx(), staff(), staff())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual([])
  })

  it('a role change to the SAME role emits nothing — it is not an act', () => {
    const r = decideChangeRole(ctx(), staff({ role: 'trainer' }), 'trainer', 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events).toEqual([])
  })
})
