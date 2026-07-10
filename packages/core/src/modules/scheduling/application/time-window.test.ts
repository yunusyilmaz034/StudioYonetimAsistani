import { describe, expect, it } from 'vitest'

import { instant, localDate, type StudioConfig } from '../../../shared'
import type { Weekday } from '../domain/types'
import { addDays, localDateOf, localSlotToInstant, occurrenceDates } from './time-window'

const cfg: StudioConfig = { utcOffsetMinutes: 180 }

describe('localSlotToInstant (AD-52)', () => {
  it('converts studio-local wall time to UTC by subtracting the offset', () => {
    // 09:00 local (UTC+3) === 06:00 UTC; +60 min === 07:00 UTC
    const { startsAt, endsAt } = localSlotToInstant(localDate('2026-07-14'), '09:00', 60, cfg)
    expect(new Date(startsAt).toISOString()).toBe('2026-07-14T06:00:00.000Z')
    expect(new Date(endsAt).toISOString()).toBe('2026-07-14T07:00:00.000Z')
  })
})

describe('occurrenceDates (I-25)', () => {
  it('returns weekly occurrences of the weekday within the window', () => {
    const from = localDate('2026-07-14')
    const dow = new Date(Date.UTC(2026, 6, 14)).getUTCDay() as Weekday
    expect(occurrenceDates(dow, from, localDate('2026-07-28'))).toEqual([
      '2026-07-14',
      '2026-07-21',
      '2026-07-28',
    ])
  })

  it('is empty when no date matches', () => {
    // Single-day window on a Tuesday; a different weekday can never fall inside it.
    const from = localDate('2026-07-14')
    const otherDow = ((new Date(Date.UTC(2026, 6, 14)).getUTCDay() + 1) % 7) as Weekday
    expect(occurrenceDates(otherDow, from, from)).toEqual([])
  })
})

describe('addDays / localDateOf', () => {
  it('adds days across a month boundary', () => {
    expect(addDays(localDate('2026-07-30'), 3)).toBe('2026-08-02')
  })
  it('localDateOf shifts a UTC instant into the studio-local date', () => {
    expect(localDateOf(instant(Date.UTC(2026, 6, 14, 22, 30)), cfg)).toBe('2026-07-15')
  })
})
