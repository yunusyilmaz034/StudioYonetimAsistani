import type { LocalDate } from '../../shared'
import type { CalendarDayType } from './domain/types'

// D23 — calendar events. Informational by nature: nothing here moves a credit or cancels a
// class. They exist so the calendar has a history (who marked the studio closed, and when),
// which is exactly the question that gets asked after a closure goes wrong.
//
// No PII (I-13). Additive event TYPES — no version bump anywhere (AD-52).
export const STUDIO_CALENDAR_DAY_MARKED = 'studio_calendar.day_marked'
export const STUDIO_CALENDAR_DAY_UPDATED = 'studio_calendar.day_updated'
export const STUDIO_CALENDAR_DAY_REMOVED = 'studio_calendar.day_removed'
export const STUDIO_CALENDAR_IMPORTED = 'studio_calendar.imported'

export type StudioCalendarDayMarkedPayload = {
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
  readonly type: CalendarDayType
  readonly source: 'manual' | 'provider'
}
export type StudioCalendarDayUpdatedPayload = {
  readonly changedFields: readonly string[]
}
export type StudioCalendarDayRemovedPayload = {
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
  readonly type: CalendarDayType
}
// The provenance of an import RUN — never the content of the days (that is state).
export type StudioCalendarImportedPayload = {
  readonly provider: string
  readonly year: number
  readonly daysImported: number
  readonly daysUpdated: number
  readonly daysSkipped: number
}
