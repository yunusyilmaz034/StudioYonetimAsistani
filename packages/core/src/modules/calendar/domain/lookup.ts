import type { BranchId, LocalDate } from '../../../shared'
import { CLOSED_TYPES, type CalendarDayType, type StudioCalendarDay } from './types'

// D23 — the read side of the calendar: "what, if anything, is special about this date?"
//
// PURE, and deliberately the ONLY place that answers it. The schedule screen, the series
// planner and the closure preview all ask this same function — so a holiday cannot be visible
// on one screen and invisible to the planner on the next.
//
// There is NO denormalised "isHoliday" flag on ClassSession, on purpose: it would be a second
// source of truth that drifts the moment the calendar is edited. A session that sits on a
// holiday is derivable — date ⋈ calendar — and derivable is the only thing that cannot drift.

export function daysOn(
  days: readonly StudioCalendarDay[],
  date: LocalDate,
  branchId?: BranchId,
): readonly StudioCalendarDay[] {
  return days.filter((d) => {
    if (date < d.dateFrom || date > d.dateTo) return false
    if (d.branchIds === null) return true // studio-wide
    return branchId === undefined || d.branchIds.includes(branchId)
  })
}

// Is the studio saying "we are not running classes here"? `studio_closed` / `maintenance` —
// and NOT a public holiday, because a public holiday is a fact about the country, not a
// decision by the studio. Plenty of studios open on 1 May.
export function isClosedOn(
  days: readonly StudioCalendarDay[],
  date: LocalDate,
  branchId?: BranchId,
): boolean {
  return daysOn(days, date, branchId).some((d) => CLOSED_TYPES.includes(d.type))
}

// Anything worth WARNING about when a session is created on this date (D23.3). A
// `special_working_day` is the studio explicitly saying "open" — it warns about nothing.
export function markedTypesOn(
  days: readonly StudioCalendarDay[],
  date: LocalDate,
  branchId?: BranchId,
): readonly CalendarDayType[] {
  return daysOn(days, date, branchId)
    .map((d) => d.type)
    .filter((t) => t !== 'special_working_day')
}
