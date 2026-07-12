import type { BranchId, Instant, LocalDate, StudioId } from '../../../shared'

// D23 (v1.22) — the Studio Calendar.
//
// The distinction the whole module rests on, and it is the reason this is a separate aggregate
// from anything destructive:
//
//   **"Resmî tatil" is a FACT about the calendar. "Stüdyo kapalı" is a REVERSIBLE owner
//   decision. Neither ever cancels a session, releases a reservation, or extends a package.**
//
// The calendar *informs*. D21 (Closure Operations) *acts* — and only when a human presses the
// button. If marking a day could cancel classes by itself, a typo in a date field would refund
// the studio's July.

// A closed enum, for the same reason `Category` is: the schedule screen, the closure flow and
// (Phase 2) the AI all branch on it. A stringly-typed admin field would make every one of those
// a guess.
export const CalendarDayTypes = [
  'public_holiday', // resmî tatil
  'public_holiday_half', // yarım gün resmî tatil (arife)
  'religious_holiday', // bayram
  'studio_closed', // stüdyo kapalı — an owner decision, not a fact about the country
  'maintenance', // bakım
  'trainer_training', // eğitmen eğitimi
  'special_event', // özel etkinlik
  'special_working_day', // özel çalışma günü (open when you'd expect closed)
] as const
export type CalendarDayType = (typeof CalendarDayTypes)[number]

// Which types the studio treats as "we are not running classes here". Used by the schedule
// warnings (D23.3) and as the default skip in series generation (D23.4). `special_working_day`
// is deliberately absent: it exists to say "open anyway".
export const CLOSED_TYPES: readonly CalendarDayType[] = ['studio_closed', 'maintenance']

// Provenance. An imported day carries where it came from, so a later re-import can update it
// without touching what the owner wrote by hand.
export type CalendarSource = 'manual' | 'provider'

export interface ProviderRef {
  readonly provider: string // e.g. 'tr-official'
  readonly externalId: string // stable id in the source
  readonly importedAt: Instant
}

export interface StudioCalendarDay {
  readonly id: string
  readonly studioId: StudioId
  readonly dateFrom: LocalDate // a single day has dateFrom === dateTo
  readonly dateTo: LocalDate
  // An intra-day closure ("14:00–18:00 bakım"). Absent ⇒ the whole day.
  readonly timeFrom: string | null // 'HH:MM'
  readonly timeTo: string | null
  readonly type: CalendarDayType
  readonly title: string
  readonly note: string | null
  readonly branchIds: readonly BranchId[] | null // null ⇒ the whole studio
  readonly source: CalendarSource
  readonly providerRef: ProviderRef | null
  readonly createdAt: Instant
}

// ── The external holiday source: a PORT, never a dependency ────────────────────────────────
//
// The domain depends on this shape and on nothing else. Swapping the source (an API, a table, a
// government feed) is an ADAPTER change — the calendar never learns where its days came from
// beyond `providerRef`.
//
// Imported days are SNAPSHOTTED into `StudioCalendarDay`. If the provider changes its answer
// next year, our history does not move: a closure applied last July was applied against the
// calendar as it stood. (The same principle as the policy snapshot, D14, and the product
// snapshot, D12 — and for the same reason.)
export interface ProviderHoliday {
  readonly externalId: string
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
  readonly type: CalendarDayType
  readonly title: string
}

export interface HolidayProvider {
  readonly name: string
  listHolidays(country: string, year: number): Promise<readonly ProviderHoliday[]>
}
