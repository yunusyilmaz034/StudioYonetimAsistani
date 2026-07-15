// Fitness read-layer types (Plus Phase 8). No aggregate, no event — this module only
// interprets check-in facts the checkin module already records.

// The anonymous occupancy band shown to members. Never a headcount to a member (§11 privacy):
// she sees "Orta", not "7 kişi içeride".
export type OccupancyLevel = 'quiet' | 'moderate' | 'busy' | 'very_busy'

// The studio's occupancy thresholds — DATA, not a literal (#4's spirit). A boutique studio and a
// large gym want different bands, and neither should need a deploy. `capacity` is the building's
// physical capacity (people at once), `*At` are ascending fractions of it (0..1). Capacity 0 = unset.
export interface FitnessOccupancyConfig {
  readonly capacity: number
  readonly moderateAt: number
  readonly busyAt: number
  readonly veryBusyAt: number
}

// A member's consistency, computed on read from her check-in days.
export interface VisitStats {
  readonly totalVisitDays: number
  readonly currentWeekVisits: number
  readonly currentStreakWeeks: number
  readonly longestStreakWeeks: number
  readonly lastVisitEpochDay: number | null
}

// One historical sample for the busy-ness histogram: which weekday (0=Mon..6=Sun) and hour a
// check-in happened, in the studio's local time (the caller does the timezone shift).
export interface WeekdayHour {
  readonly weekday: number
  readonly hour: number
}

export interface BusyBucket {
  readonly weekday: number
  readonly hour: number
  readonly count: number
}
