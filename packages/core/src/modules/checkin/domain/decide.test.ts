import { describe, expect, it } from 'vitest'

import {
  instant,
  type BranchId,
  type CheckInId,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import {
  decideAutoCheckOut,
  decideCheckIn,
  decideCloseBranch,
  decideOpenBranch,
  decideRedeemTurnstileCode,
} from './decide'
import type { DecideContext } from './decide'
import type { BranchOccupancy, Presence, TurnstileCode, TurnstileDevice } from './types'

const NOW = instant(1_700_000_000_000)
const H = 3_600_000
const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const BR = 'brn_1' as BranchId
const MEM = 'mem_1' as MemberId
const openBranch: BranchOccupancy = { branchId: BR, isOpen: true, openedAt: instant(NOW - 3 * H) }
const input = { checkInId: 'chk_1' as CheckInId, memberId: MEM, branchId: BR, method: 'qr' as const }

describe('decideOpenBranch / decideCloseBranch (D3)', () => {
  it('opens a closed branch', () => {
    const r = decideOpenBranch(ctx, BR, null)
    expect(r.events[0]?.type).toBe('branch.opened')
    expect(r.branchNext).toMatchObject({ isOpen: true })
  })
  it('is idempotent when already open', () => {
    expect(decideOpenBranch(ctx, BR, openBranch).events).toHaveLength(0)
  })
  it('closes with the occupancy at close', () => {
    const r = decideCloseBranch(ctx, BR, openBranch, 5)
    expect(r.events[0]?.payload).toEqual({ occupancyAtClose: 5 })
    expect(r.branchNext.isOpen).toBe(false)
  })
})

describe('decideCheckIn (D5, toggle)', () => {
  it('checks IN when the member is outside, reports occupancyAfter', () => {
    const r = decideCheckIn(ctx, input, null, 4, openBranch)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.events[0]?.type).toBe('member.checked_in')
      expect(r.value.events[0]?.payload).toEqual({ branchId: BR, method: 'qr', occupancyAfter: 5 })
      expect(r.value.checkIn.direction).toBe('in')
      expect(r.value.presenceNext).toMatchObject({ memberId: MEM })
    }
  })
  it('checks OUT when the member is inside, computes duration', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 90 * 60_000) }
    const r = decideCheckIn(ctx, input, presence, 5, openBranch)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.events[0]?.type).toBe('member.checked_out')
      expect(r.value.events[0]?.payload).toMatchObject({ durationMinutes: 90, occupancyAfter: 4 })
      expect(r.value.checkIn.direction).toBe('out')
      expect(r.value.presenceNext).toBeNull()
    }
  })
  // 2026-07-31 — a member left at 18:41:27 and was "inside" again at 18:41:49, because a second
  // press of a button labelled "Çıkış" toggled her back in. A labelled button STATES a direction;
  // only a QR (which has no label, one code for both ways) may toggle.
  it('refuses a check-OUT for somebody who is already outside', () => {
    const r = decideCheckIn(ctx, { ...input, direction: 'out' }, null, 4, openBranch)
    expect(r).toEqual({ ok: false, error: { code: 'already_outside' } })
  })
  it('refuses a check-IN for somebody who is already inside', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 10 * 60_000) }
    const r = decideCheckIn(ctx, { ...input, direction: 'in' }, presence, 5, openBranch)
    expect(r).toEqual({ ok: false, error: { code: 'already_inside' } })
  })
  it('honours a stated direction that matches the state', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 10 * 60_000) }
    const r = decideCheckIn(ctx, { ...input, direction: 'out' }, presence, 5, openBranch)
    expect(r.ok).toBe(true)
  })

  // The QR keeps toggling, so it gets the other guard: two scans inside 45 s are one person holding
  // the phone still, not a visit that lasted forty seconds.
  it('refuses a second toggle within the debounce window', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 20_000) }
    const r = decideCheckIn(ctx, { ...input, lastCrossedAt: instant(NOW - 20_000) }, presence, 5, openBranch)
    expect(r).toEqual({ ok: false, error: { code: 'checkin_too_soon' } })
  })
  it('allows a toggle once the window has passed', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 60_000) }
    const r = decideCheckIn(ctx, { ...input, lastCrossedAt: instant(NOW - 46_000) }, presence, 5, openBranch)
    expect(r.ok).toBe(true)
  })
  // A STATED direction is never debounced: reception pressing "Çıkış" 10 s after the QR let her in
  // is a correction of a mistake, and refusing it would leave her stuck inside.
  it('does not debounce a stated direction', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 10_000) }
    const r = decideCheckIn(
      ctx,
      { ...input, direction: 'out', lastCrossedAt: instant(NOW - 10_000) },
      presence,
      5,
      openBranch,
    )
    expect(r.ok).toBe(true)
  })

  it('refuses when the branch is not open', () => {
    expect(decideCheckIn(ctx, input, null, 0, null)).toEqual({ ok: false, error: { code: 'branch_not_open' } })
    expect(decideCheckIn(ctx, input, null, 0, { branchId: BR, isOpen: false, openedAt: null })).toEqual({
      ok: false,
      error: { code: 'branch_not_open' },
    })
  })
})

describe('decideAutoCheckOut (D4, system)', () => {
  it('emits member.auto_checked_out with the threshold', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 5 * H) }
    const events = decideAutoCheckOut(ctx, presence, 4)
    expect(events[0]?.type).toBe('member.auto_checked_out')
    expect(events[0]?.payload).toEqual({ branchId: BR, thresholdHours: 4 })
  })
})

// ── TURNSTILE (v1.33) ────────────────────────────────────────────────────────────────────────
//
// The screen in the corridor shows a rotating code; the member scans it with her phone. Every rule
// below exists because the screen is PUBLIC — a code that can be photographed must be worth nothing
// a minute later, and worth nothing twice.

describe('decideRedeemTurnstileCode', () => {
  const device = (over: Partial<TurnstileDevice> = {}): TurnstileDevice => ({
    id: 'dev_1' as never,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    name: 'Giriş turnikesi',
    secretHash: 'x',
    active: true,
    lastSeenAt: null,
    createdAt: NOW,
    ...over,
  })
  const code = (over: Partial<TurnstileCode> = {}): TurnstileCode => ({
    code: '482913',
    deviceId: 'dev_1' as never,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    issuedAt: NOW,
    expiresAt: instant(NOW + 60_000),
    usedBy: null,
    usedAt: null,
    ...over,
  })
  const inside: Presence = { memberId: 'mem_1' as MemberId, branchId: 'brn_1' as BranchId, checkedInAt: NOW }

  it('lets a member outside come IN', () => {
    const r = decideRedeemTurnstileCode(ctx, { code: code(), device: device(), reportedDirection: null, presence: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('in')
  })

  it('lets a member inside go OUT', () => {
    const r = decideRedeemTurnstileCode(ctx, { code: code(), device: device(), reportedDirection: null, presence: inside })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  // The wire beats the inference: what the arm DID beats what we assumed she meant. This is the
  // case that repairs a drifted presence — she is recorded inside but actually walks in.
  it('obeys the arm when the direction wire reports one', () => {
    const r = decideRedeemTurnstileCode(ctx, { code: code(), device: device(), reportedDirection: 'in', presence: inside })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('in')
  })

  // ── The screen's declared side (owner, 2026-08-26) ──────────────────────────────────────
  //
  // Two screens, one each side of the arm. The side is not a guess about the member, it is a fact
  // about where the box is bolted — and it is the whole reason mandatory exit-scanning gives
  // certain occupancy rather than a plausible number.
  it('an EXIT screen records an exit, even for a member we believe is outside', () => {
    // The case that used to go wrong: presence had drifted (she left without scanning yesterday),
    // so the inference said "she must be coming in" and recorded the opposite of what happened.
    const r = decideRedeemTurnstileCode(ctx, {
      code: code(),
      device: device({ side: 'out' }),
      reportedDirection: null,
      presence: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  it('an ENTRY screen records an entry, even for a member we believe is inside', () => {
    const r = decideRedeemTurnstileCode(ctx, {
      code: code(),
      device: device({ side: 'in' }),
      reportedDirection: null,
      presence: inside,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('in')
  })

  it('the ARM still outranks the screen — what the door did beats where the box is', () => {
    const r = decideRedeemTurnstileCode(ctx, {
      code: code(),
      device: device({ side: 'in' }),
      reportedDirection: 'out',
      presence: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  it('a device with NO side declared behaves exactly as before', () => {
    // Every door paired before this field existed. Absence must read as "no side to declare",
    // never as a side of its own.
    const r = decideRedeemTurnstileCode(ctx, {
      code: code(),
      device: device({ side: null }),
      reportedDirection: null,
      presence: inside,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  it('REFUSES an expired code — the whole point of a public screen', () => {
    const late = { ...ctx, now: instant(NOW + 60_001) }
    const r = decideRedeemTurnstileCode(late, { code: code(), device: device(), reportedDirection: null, presence: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('qr_expired')
  })

  // The boundary: exactly at expiry is already too late.
  it('refuses at the exact expiry instant', () => {
    const edge = { ...ctx, now: instant(NOW + 60_000) }
    expect(decideRedeemTurnstileCode(edge, { code: code(), device: device(), reportedDirection: null, presence: null }).ok).toBe(false)
  })

  it('REFUSES a code someone has already crossed on', () => {
    const r = decideRedeemTurnstileCode(ctx, {
      code: code({ usedBy: 'mem_9' as MemberId, usedAt: NOW }),
      device: device(),
      reportedDirection: null,
      presence: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('qr_used')
  })

  it('refuses an unknown code, an unknown device, and a deactivated one', () => {
    expect(decideRedeemTurnstileCode(ctx, { code: null, device: device(), reportedDirection: null, presence: null }).ok).toBe(false)
    expect(decideRedeemTurnstileCode(ctx, { code: code(), device: null, reportedDirection: null, presence: null }).ok).toBe(false)
    expect(decideRedeemTurnstileCode(ctx, { code: code(), device: device({ active: false }), reportedDirection: null, presence: null }).ok).toBe(false)
  })

  // A code minted by the OTHER door must not open this one — two turnstiles, two screens, and a
  // member walking between them with a photograph.
  it('refuses a code belonging to a different device', () => {
    const r = decideRedeemTurnstileCode(ctx, {
      code: code({ deviceId: 'dev_2' as never }),
      device: device(),
      reportedDirection: null,
      presence: null,
    })
    expect(r.ok).toBe(false)
  })
})
