// The calendar module's only public door (AD-29). D23 (v1.22).
//
// It writes INFORMATION. It never cancels a session, releases a reservation or extends a
// package — that is D21, and it only ever runs when a human presses the button.
export {
  CalendarDayTypes,
  CLOSED_TYPES,
  type CalendarDayType,
  type CalendarSource,
  type HolidayProvider,
  type ProviderHoliday,
  type ProviderRef,
  type StudioCalendarDay,
} from './domain/types'
export { daysOn, isClosedOn, markedTypesOn } from './domain/lookup'
export * from './events'
export {
  importHolidays,
  markCalendarDay,
  removeCalendarDay,
  type ImportSummary,
  type MarkDayInput,
} from './application/calendar'
export type { CalendarDeps, CalendarRepository } from './application/ports'
export { FirestoreCalendarRepository } from './infrastructure/repos'
