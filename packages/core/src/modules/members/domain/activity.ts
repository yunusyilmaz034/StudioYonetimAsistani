import type { Instant, MemberId } from '../../../shared'

// ── Member activity stats (Phase 2 · the churn seam) ──────────────────────────────────────────
// `Member.stats.lastCheckInAt` / `lastAttendanceAt` are the recency the dormancy signal reads: an
// active member who has stopped coming is the churn the whole event model was built to surface. These
// fields are DENORMALISED and REBUILDABLE — a reactor maxes them forward from events, and
// `member-stats:rebuild` recomputes them by replaying the log (so they are a projection onto the
// aggregate doc, never authoritative).
//
// THREE event types feed activity, and the exclusion is deliberate:
//   • member.checked_in    — she walked through the door. The strongest, unambiguous signal.
//   • reservation.attended — she was OBSERVED present in class (trainer/reception).
//   • reservation.booked   — she BOOKED a class. Member-INITIATED engagement, and the only activity a
//     studio that neither door-scans nor marks attendance still produces. It is not a presumption —
//     she took the action herself — so it belongs here.
// `reservation.auto_resolved` is NOT here: a presumption is not an observation (#11). "Presumed
// present" must never light up as "she came", or the churn signal is a structural lie.
export type MemberActivityField = 'lastCheckInAt' | 'lastAttendanceAt' | 'lastBookingAt'

export interface MemberActivityTouch {
  readonly memberId: MemberId
  readonly field: MemberActivityField
  readonly at: Instant
}

interface ActivityEventLike {
  readonly type: string
  readonly occurredAt: Instant
  readonly related?: { readonly memberId?: string | null } | null
}

// Pure: which activity field this event bumps, or null if it is not an activity event. The reactor
// applies it as a MAX, so it is idempotent and cannot regress on redelivery or out-of-order arrival.
export function memberActivityFromEvent(event: ActivityEventLike): MemberActivityTouch | null {
  const memberId = event.related?.memberId
  if (!memberId) return null
  switch (event.type) {
    case 'member.checked_in':
      return { memberId: memberId as MemberId, field: 'lastCheckInAt', at: event.occurredAt }
    case 'reservation.attended':
      return { memberId: memberId as MemberId, field: 'lastAttendanceAt', at: event.occurredAt }
    case 'reservation.booked':
      return { memberId: memberId as MemberId, field: 'lastBookingAt', at: event.occurredAt }
    default:
      return null
  }
}

// The most recent moment we OBSERVED the member engage — or `null` if we never did. `null` is not
// "dormant": dormancy means "was active, and stopped", so a member we have never seen engage is
// UNKNOWN, not churning (registering is not engaging). This is what keeps the signal honest when a
// studio has not started recording check-ins/attendance — those members read as "no activity", never
// as a wall of false red. `joinedAt` is deliberately NOT a floor here.
export function lastActivityAt(stats: {
  readonly lastCheckInAt: Instant | null
  readonly lastAttendanceAt: Instant | null
  readonly lastBookingAt: Instant | null
}): Instant | null {
  const latest = Math.max(stats.lastCheckInAt ?? 0, stats.lastAttendanceAt ?? 0, stats.lastBookingAt ?? 0)
  return latest > 0 ? (latest as Instant) : null
}
