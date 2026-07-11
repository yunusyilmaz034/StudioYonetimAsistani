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
} from './decide'
import type { DecideContext } from './decide'
import type { BranchOccupancy, Presence } from './types'

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
