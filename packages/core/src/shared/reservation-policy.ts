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
  // Plus Phase 4 — a member may be limited to certain trainers. null/absent ⇒ any trainer. Trainer
  // ids are opaque strings here (no cross-module id import); the caller compares them to session.trainerId.
  readonly allowedTrainerIds?: readonly string[] | null
  // Plus Phase 4 — the override's validity window (epoch ms). null/absent ⇒ open-ended on that side.
  // OUTSIDE the window the override does not apply and the member falls back to the package rules —
  // "süre dolunca otomatik olarak paket kurallarına döner", enforced at read time (no sweep needed).
  readonly effectiveFrom?: number | null
  readonly effectiveUntil?: number | null
}

// Whether the override is in force at `now`. An expired or not-yet-started override is INERT — the
// resolver is given `null` and the member is judged by the package rules, automatically.
export function isOverrideActiveAt(o: ReservationOverride, now: number): boolean {
  if (o.effectiveFrom != null && now < o.effectiveFrom) return false
  if (o.effectiveUntil != null && now > o.effectiveUntil) return false
  return true
}

export function trainerAllowed(allowed: readonly string[] | null | undefined, trainerId: string | null): boolean {
  if (allowed == null) return true
  return trainerId != null && allowed.includes(trainerId)
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
