import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type LocalDate, type StudioId } from '../../../shared'
import { daysOn, isClosedOn, markedTypesOn } from './lookup'
import type { CalendarDayType, StudioCalendarDay } from './types'

// D23 — the calendar's read side. Every screen and every planner asks THESE functions, so a
// holiday cannot be visible on one surface and invisible to the next.

const day = (
  type: CalendarDayType,
  from: string,
  to = from,
  branchIds: readonly BranchId[] | null = null,
): StudioCalendarDay => ({
  id: `cal_${from}_${type}`,
  studioId: 'std_1' as StudioId,
  dateFrom: from as LocalDate,
  dateTo: to as LocalDate,
  timeFrom: null,
  timeTo: null,
  type,
  title: type,
  note: null,
  branchIds,
  source: 'manual',
  providerRef: null,
  createdAt: instant(1),
})

const D = (s: string) => s as LocalDate

describe('calendar lookup (D23)', () => {
  const days = [
    day('public_holiday', '2026-04-23'),
    day('religious_holiday', '2026-03-20', '2026-03-22'), // a multi-day bayram
    day('studio_closed', '2026-07-19', '2026-07-26'),
    day('maintenance', '2026-09-01', '2026-09-01', ['brn_a' as BranchId]),
    day('special_working_day', '2026-01-01'), // open, deliberately, on a holiday
  ]

  it('finds a single-day mark', () => {
    expect(daysOn(days, D('2026-04-23')).map((d) => d.type)).toEqual(['public_holiday'])
  })

  it('finds a mark INSIDE a multi-day range, not just at its edges', () => {
    expect(daysOn(days, D('2026-03-21')).map((d) => d.type)).toEqual(['religious_holiday'])
    expect(daysOn(days, D('2026-03-23'))).toEqual([]) // one day past the end
  })

  it('a studio-wide day applies to every branch; a branch-scoped one does not', () => {
    expect(isClosedOn(days, D('2026-07-20'), 'brn_b' as BranchId)).toBe(true) // studio_closed, null branches
    expect(isClosedOn(days, D('2026-09-01'), 'brn_a' as BranchId)).toBe(true)
    expect(isClosedOn(days, D('2026-09-01'), 'brn_b' as BranchId)).toBe(false) // another branch's maintenance
  })

  it('a PUBLIC HOLIDAY is not "closed" — that is a fact about the country, not a decision by the studio', () => {
    // Plenty of studios open on 1 May. Treating a public holiday as a closure would silently
    // delete classes the owner intended to run.
    expect(isClosedOn(days, D('2026-04-23'))).toBe(false)
    expect(markedTypesOn(days, D('2026-04-23'))).toEqual(['public_holiday']) // …but it still WARNS
  })

  it('studio_closed and maintenance ARE closed', () => {
    expect(isClosedOn(days, D('2026-07-19'))).toBe(true)
    expect(isClosedOn(days, D('2026-09-01'), 'brn_a' as BranchId)).toBe(true)
  })

  it('a special_working_day warns about nothing — it exists to say "open anyway"', () => {
    expect(markedTypesOn(days, D('2026-01-01'))).toEqual([])
    expect(isClosedOn(days, D('2026-01-01'))).toBe(false)
  })

  it('an unmarked day is silent', () => {
    expect(daysOn(days, D('2026-02-02'))).toEqual([])
    expect(markedTypesOn(days, D('2026-02-02'))).toEqual([])
    expect(isClosedOn(days, D('2026-02-02'))).toBe(false)
  })
})
