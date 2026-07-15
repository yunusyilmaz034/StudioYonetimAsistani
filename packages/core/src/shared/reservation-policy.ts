// ── Reservation policy value objects (Plus Phase 3) ─────────────────────────────────────────
//
// Shared, PII-free value types for Package Rules 2.0. They live in `shared` because BOTH the
// members module (which stores a member's override) and the reservations module (which resolves
// the effective rule at booking/cancel time) speak them — and neither may import the other. They
// are plain data: weekday numbers, minute offsets, and counts. No identity, ever.

// A time-of-day window in the STUDIO's local timezone, minutes from midnight. `end` is exclusive
// and MUST be greater than `start`: a midnight-crossing window (22:00–02:00) is refused at the
// edge, never silently assumed (owner: "sessiz varsayım yapma").
export interface HourRange {
  readonly startMinutes: number // [0, 1440)
  readonly endMinutes: number // (start, 1440]
}

// A member's optional override of the package rules. Each field is tri-state:
//   • absent (undefined) ⇒ INHERIT the package rule (say nothing about it)
//   • null               ⇒ UNLIMITED / no restriction (deliberately loosen)
//   • a value            ⇒ that specific limit / restriction
// `allowedWeekdays` / `allowedHourRanges` have no package level, so there null/absent both mean
// "no restriction". Weekdays are 0=Sunday … 6=Saturday (studio-local).
export interface ReservationOverride {
  readonly allowedWeekdays?: readonly number[] | null
  readonly allowedHourRanges?: readonly HourRange[] | null
  readonly cancellationAllowance?: number | null
  readonly dailyReservationLimit?: number | null
  readonly activeReservationLimit?: number | null
}

// Whether a given studio-local weekday / minute-of-day is permitted by a restriction. A null list
// means "unrestricted".
export function weekdayAllowed(allowed: readonly number[] | null | undefined, weekday: number): boolean {
  return allowed == null || allowed.includes(weekday)
}
export function timeAllowed(ranges: readonly HourRange[] | null | undefined, minuteOfDay: number): boolean {
  return ranges == null || ranges.some((r) => minuteOfDay >= r.startMinutes && minuteOfDay < r.endMinutes)
}

// A well-formed hour range: inside the day and non-crossing. Used by the member-restriction decider
// to REFUSE a bad range rather than guess what a crossing one meant.
export function hourRangeValid(r: HourRange): boolean {
  return (
    Number.isInteger(r.startMinutes) &&
    Number.isInteger(r.endMinutes) &&
    r.startMinutes >= 0 &&
    r.endMinutes > r.startMinutes &&
    r.endMinutes <= 1440
  )
}
