import { describe, expect, it } from 'vitest'

import { weeklyVisitCounts } from './client'

// The strip encodes a decision about what a member is shown about HERSELF, so "when does it appear
// at all" gets tests rather than a comment. See the note above the function.

const WEEK = 7 * 86_400_000
const NOW = 1_800_000_000_000
const weeksAgo = (n: number) => NOW - n * WEEK

describe('weeklyVisitCounts', () => {
  it('says nothing when there is barely any history', () => {
    expect(weeklyVisitCounts([], NOW)).toBeNull()
    expect(weeklyVisitCounts([weeksAgo(0), weeksAgo(1)], NOW)).toBeNull()
  })

  it('appears at three visits', () => {
    expect(weeklyVisitCounts([weeksAgo(0), weeksAgo(1), weeksAgo(2)], NOW)).not.toBeNull()
  })

  it('returns eight weeks, oldest first, with this week last', () => {
    const bars = weeklyVisitCounts([weeksAgo(0), weeksAgo(0), weeksAgo(0)], NOW)!
    expect(bars).toHaveLength(8)
    expect(bars.at(-1)).toBe(3)
    expect(bars.slice(0, 7).every((n) => n === 0)).toBe(true)
  })

  it('buckets each visit into its own week', () => {
    const bars = weeklyVisitCounts([weeksAgo(0), weeksAgo(1), weeksAgo(1), weeksAgo(3)], NOW)!
    expect(bars.at(-1)).toBe(1)
    expect(bars.at(-2)).toBe(2)
    expect(bars.at(-4)).toBe(1)
  })

  it('ignores anything older than the window without dropping off the array', () => {
    const bars = weeklyVisitCounts([weeksAgo(0), weeksAgo(1), weeksAgo(2), weeksAgo(40)], NOW)!
    expect(bars).toHaveLength(8)
    expect(bars.reduce((a, b) => a + b, 0)).toBe(3)
  })

  // History but nothing inside the window would draw eight empty bars — the exact chart the rule
  // exists to prevent.
  it('says nothing when every visit is outside the window', () => {
    expect(weeklyVisitCounts([weeksAgo(20), weeksAgo(30), weeksAgo(40)], NOW)).toBeNull()
  })
})
