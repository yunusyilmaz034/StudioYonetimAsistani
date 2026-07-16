// The fitness module's only public door (Plus Phase 8 — Fitness Attendance & Occupancy). A pure
// read/report layer over the checkin module's `member.checked_in` facts: it emits NO events, defines
// NO aggregate, and touches NO credit (see README — "the one to hold").
export type {
  BusyBucket,
  FitnessOccupancyConfig,
  OccupancyLevel,
  VisitStats,
  WeekdayHour,
} from './domain/types'
export { DEFAULT_FITNESS_CONFIG, occupancyLevel } from './domain/occupancy'
export { computeVisitStats, weekOrdinal } from './domain/streaks'
export { busiestBuckets, weekdayHourHistogram } from './domain/predict'
