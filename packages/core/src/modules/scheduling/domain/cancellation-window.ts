import { err, ok, type DomainError, type Result } from '../../../shared'
import type { CancellationWindowSource, SchedulingPolicy, StudioSettings } from './types'

// D14 (v1.21) — resolving the cancellation window.
//
// The chain (owner, 2026-07-12):
//   1. the session-specific override
//   2. the SERVICE default in force at session creation
//   3. the STUDIO default in force at session creation
//   4. the system default — 6 h
//
// Two things this function is careful about, and both are load-bearing:
//
// • **It runs once, at session creation, and the answer is stamped.** It is never re-run at
//   read time. Policy is versioned data stamped at the moment of the decision (non-negotiable
//   #4): if the studio default changed tonight, a class booked last week must keep the terms
//   it was booked under. Resolving live would rewrite them retroactively, invisibly, and in
//   the member's disfavour.
//
// • **The number six is not here.** "Nothing in the code knows the number six." Level 4 is not
//   a fallback in the domain — it is the value a studio is PROVISIONED with, written into
//   `StudioSettings.defaultCancellationWindowHours` at installation. Data, not an `if`. If no
//   level answers, this REFUSES. A studio with no window configured anywhere is a
//   misconfiguration, and a misconfiguration must be visible, not silently papered over with a
//   number the code made up.
export function resolveCancellationWindow(input: {
  readonly sessionOverride: number | null
  readonly servicePolicy: SchedulingPolicy
  readonly studioSettings: StudioSettings | null
}): Result<{ hours: number; source: CancellationWindowSource }, DomainError> {
  if (input.sessionOverride !== null) {
    return ok({ hours: input.sessionOverride, source: 'session' })
  }
  const service = input.servicePolicy.cancellationWindowHours
  if (service !== null) {
    return ok({ hours: service, source: 'service' })
  }
  const studio = input.studioSettings?.defaultCancellationWindowHours ?? null
  if (studio !== null) {
    return ok({ hours: studio, source: 'studio' })
  }
  return err({ code: 'cancellation_window_unresolved' })
}
