import { describe, expect, it } from 'vitest'

import { instant } from '../../../shared'
import { lastActivityAt, memberActivityFromEvent } from './activity'

const at = instant(1_700_000_000_000)
const ev = (type: string, memberId: string | null | undefined) => ({
  type,
  occurredAt: at,
  related: memberId === undefined ? null : { memberId },
})

describe('memberActivityFromEvent', () => {
  it('member.checked_in → lastCheckInAt (she walked through the door)', () => {
    expect(memberActivityFromEvent(ev('member.checked_in', 'mem_1'))).toEqual({
      memberId: 'mem_1',
      field: 'lastCheckInAt',
      at,
    })
  })

  it('reservation.attended → lastAttendanceAt (she was OBSERVED present)', () => {
    expect(memberActivityFromEvent(ev('reservation.attended', 'mem_1'))).toEqual({
      memberId: 'mem_1',
      field: 'lastAttendanceAt',
      at,
    })
  })

  it('reservation.booked → lastBookingAt (member-initiated engagement, not a presumption)', () => {
    expect(memberActivityFromEvent(ev('reservation.booked', 'mem_1'))).toEqual({
      memberId: 'mem_1',
      field: 'lastBookingAt',
      at,
    })
  })

  it('reservation.auto_resolved is NOT activity — a presumption is not an observation (#11)', () => {
    expect(memberActivityFromEvent(ev('reservation.auto_resolved', 'mem_1'))).toBeNull()
  })

  it('ignores events with no member and unrelated types', () => {
    expect(memberActivityFromEvent(ev('member.checked_in', undefined))).toBeNull()
    expect(memberActivityFromEvent(ev('member.checked_in', null))).toBeNull()
    expect(memberActivityFromEvent(ev('payment.received', 'mem_1'))).toBeNull()
  })
})

describe('lastActivityAt', () => {
  it('takes the most recent of check-in / attendance / booking', () => {
    expect(lastActivityAt({ lastCheckInAt: instant(5_000), lastAttendanceAt: instant(3_000), lastBookingAt: instant(1_000) })).toBe(5_000)
    expect(lastActivityAt({ lastCheckInAt: instant(2_000), lastAttendanceAt: null, lastBookingAt: instant(8_000) })).toBe(8_000)
  })

  it('is NULL when we never observed her engage — that is UNKNOWN, not dormant', () => {
    expect(lastActivityAt({ lastCheckInAt: null, lastAttendanceAt: null, lastBookingAt: null })).toBeNull()
  })
})
