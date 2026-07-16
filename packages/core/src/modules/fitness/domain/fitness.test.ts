import { describe, expect, it } from 'vitest'

import { busiestBuckets, weekdayHourHistogram } from './predict'
import { DEFAULT_FITNESS_CONFIG, occupancyLevel } from './occupancy'
import { computeVisitStats, weekOrdinal } from './streaks'

describe('occupancyLevel — the anonymous band is DATA-driven, never an if (§4 spirit)', () => {
  const cfg = { capacity: 20, moderateAt: 0.4, busyAt: 0.7, veryBusyAt: 0.9 }
  it('maps a headcount to a band by fraction of capacity', () => {
    expect(occupancyLevel(0, cfg)).toBe('quiet')
    expect(occupancyLevel(7, cfg)).toBe('quiet') // 0.35 < 0.40
    expect(occupancyLevel(8, cfg)).toBe('moderate') // 0.40
    expect(occupancyLevel(14, cfg)).toBe('busy') // 0.70
    expect(occupancyLevel(18, cfg)).toBe('very_busy') // 0.90
    expect(occupancyLevel(25, cfg)).toBe('very_busy') // over capacity
  })
  it('returns null when capacity is unset — no made-up band', () => {
    expect(occupancyLevel(5, DEFAULT_FITNESS_CONFIG)).toBeNull()
    expect(occupancyLevel(5, { ...cfg, capacity: 0 })).toBeNull()
  })
})

describe('computeVisitStats — weekly consistency over check-in DAYS, pure (no clock)', () => {
  // Epoch day 0 = Thu 1970-01-01. Week ordinals: Mon-based via weekOrdinal.
  it('counts one visit per day and the current-week visits', () => {
    // two taps on the same day = one visit day
    const s = computeVisitStats([100, 100, 101], 101)
    expect(s.totalVisitDays).toBe(2)
    expect(s.lastVisitEpochDay).toBe(101)
  })
  it('keeps a weekly streak through the still-open current week (grace)', () => {
    // weeks of days 4 (Mon, ord 1), 11 (Mon, ord 2), 18 (Mon, ord 3); "now" = day 21 (Thu ord 3)
    const s = computeVisitStats([4, 11, 18], 21)
    expect(weekOrdinal(4)).toBe(1)
    expect(weekOrdinal(18)).toBe(3)
    expect(s.currentStreakWeeks).toBe(3)
    expect(s.longestStreakWeeks).toBe(3)
  })
  it('breaks the streak after a fully skipped week', () => {
    // last visit week ord for day 4 is 1; now = day 25 (ord 4) → both current and previous week empty
    const s = computeVisitStats([4], 25)
    expect(s.currentStreakWeeks).toBe(0)
  })
  it('is empty for a member who never came', () => {
    const s = computeVisitStats([], 200)
    expect(s).toMatchObject({ totalVisitDays: 0, currentStreakWeeks: 0, lastVisitEpochDay: null })
  })
})

describe('busiestBuckets — historical busy-ness, deterministic', () => {
  it('counts and ranks (weekday,hour) buckets, ties broken by weekday then hour', () => {
    const samples = [
      { weekday: 0, hour: 18 },
      { weekday: 0, hour: 18 },
      { weekday: 2, hour: 9 },
      { weekday: 5, hour: 25 }, // out of range → ignored
    ]
    expect(weekdayHourHistogram(samples)).toHaveLength(2)
    const top = busiestBuckets(samples, 5)
    expect(top[0]).toMatchObject({ weekday: 0, hour: 18, count: 2 })
    expect(top[1]).toMatchObject({ weekday: 2, hour: 9, count: 1 })
  })
})
