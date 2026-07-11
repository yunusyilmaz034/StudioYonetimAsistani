import { describe, expect, it } from 'vitest'

import {
  decideAutoCheckOut,
  decideCheckIn,
  decideCloseBranch,
  decideOpenBranch,
} from '../../src/modules/checkin/domain/decide'
import type { DecideContext } from '../../src/modules/checkin/domain/decide'
import type { BranchOccupancy, Presence } from '../../src/modules/checkin/domain/types'
import {
  instant,
  type BranchId,
  type CheckInId,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import branchClosed from './branch.closed.v1.json'
import branchOpened from './branch.opened.v1.json'
import autoCheckedOut from './member.auto_checked_out.v1.json'
import checkedIn from './member.checked_in.v1.json'
import checkedOut from './member.checked_out.v1.json'

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

describe('check-in event payloads match golden fixtures (AD-33)', () => {
  it('branch.opened', () => {
    expect(decideOpenBranch(ctx, BR, null).events[0]?.payload).toEqual(branchOpened)
  })
  it('branch.closed', () => {
    expect(decideCloseBranch(ctx, BR, openBranch, 5).events[0]?.payload).toEqual(branchClosed)
  })
  it('member.checked_in', () => {
    const r = decideCheckIn(ctx, input, null, 4, openBranch)
    expect(r.ok && r.value.events[0]?.payload).toEqual(checkedIn)
  })
  it('member.checked_out', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 90 * 60_000) }
    const r = decideCheckIn(ctx, input, presence, 5, openBranch)
    expect(r.ok && r.value.events[0]?.payload).toEqual(checkedOut)
  })
  it('member.auto_checked_out', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 5 * H) }
    expect(decideAutoCheckOut(ctx, presence, 4)[0]?.payload).toEqual(autoCheckedOut)
  })
})
