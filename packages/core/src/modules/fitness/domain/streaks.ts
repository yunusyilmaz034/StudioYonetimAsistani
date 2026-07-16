import type { VisitStats } from './types'

// The ISO-style week ordinal (Monday-based) an epoch-day falls in — a monotonic integer so two days
// in the same Mon–Sun week compare equal and adjacent weeks differ by one. 1970-01-01 (epoch day 0)
// was a Thursday, so `+3` shifts the week boundary to Monday. PURE integer math: no Date, no clock.
export function weekOrdinal(epochDay: number): number {
  return Math.floor((epochDay + 3) / 7)
}

// A member's consistency, from the (timezone-local) epoch-days she checked in. The caller shifts
// instants into the studio's local day before flooring — the domain has no timezone and no clock.
// A "visit" is a DAY she came, not a raw check-in: two taps in one day are one visit (the fitness
// signal is "did she come", not "how many times did the door open").
//
// The streak is WEEKLY: consecutive Mon–Sun weeks with at least one visit. The current, still-open
// week is a grace period — a member who came every week but not yet THIS week keeps her streak until
// the week she actually skips (anchor falls back one week when the current week is empty).
export function computeVisitStats(visitEpochDays: readonly number[], nowEpochDay: number): VisitStats {
  const days = [...new Set(visitEpochDays)].sort((a, b) => a - b)
  if (days.length === 0) {
    return { totalVisitDays: 0, currentWeekVisits: 0, currentStreakWeeks: 0, longestStreakWeeks: 0, lastVisitEpochDay: null }
  }

  const weeks = new Set(days.map(weekOrdinal))
  const currentWeek = weekOrdinal(nowEpochDay)
  const currentWeekVisits = days.filter((d) => weekOrdinal(d) === currentWeek).length

  // Current streak: count backward from the anchor. The anchor is this week if it has a visit,
  // otherwise last week (grace for the in-progress week); if neither, the streak is broken → 0.
  let currentStreakWeeks = 0
  const anchor = weeks.has(currentWeek) ? currentWeek : weeks.has(currentWeek - 1) ? currentWeek - 1 : null
  if (anchor !== null) {
    let w = anchor
    while (weeks.has(w)) {
      currentStreakWeeks++
      w--
    }
  }

  // Longest streak: the longest run of consecutive week ordinals anywhere in her history.
  const sortedWeeks = [...weeks].sort((a, b) => a - b)
  let longestStreakWeeks = 1
  let run = 1
  for (let i = 1; i < sortedWeeks.length; i++) {
    run = sortedWeeks[i] === sortedWeeks[i - 1]! + 1 ? run + 1 : 1
    if (run > longestStreakWeeks) longestStreakWeeks = run
  }

  return {
    totalVisitDays: days.length,
    currentWeekVisits,
    currentStreakWeeks,
    longestStreakWeeks,
    lastVisitEpochDay: days[days.length - 1]!,
  }
}
