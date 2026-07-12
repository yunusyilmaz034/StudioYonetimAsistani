import { localDateAt, type Instant, type MemberId } from '../../../shared'
import { available, type Entitlement } from '../../entitlements'
import type { ClassSession } from '../../scheduling'
import { selectEntitlement } from './select-entitlement'
import type { Reservation } from './types'

// ── D18 — SABİT REZERVASYON (recurring booking), v1.22. ──────────────────────────────────────
//
// A GENERATOR, not an aggregate. "Every Tuesday at 09:00 for eight weeks" is not a thing the
// studio owns — it is eight ordinary reservations, each cancellable on its own, each holding its
// own credit. Modelling it as a standing entity would mean a member could cancel a class that
// still exists in a series, and the two truths would disagree forever.
//
// Two rules make it safe:
//   • **It never invents a session.** If the studio has not scheduled that Tuesday, no booking
//     is made — the plan says `no_session` and moves on. A generator that created classes would
//     let a reservation screen redraw the schedule.
//   • **Nothing is skipped without a name.** Every week that produces no booking lands in a
//     named bucket the owner can read. A silent gap is how reception finds out in week six.

export type RecurringSkipReason =
  | 'no_session' // the studio never scheduled a class in that slot that week
  | 'session_cancelled'
  | 'session_full'
  | 'session_in_past'
  | 'already_booked' // she is already in it — the series is idempotent
  | 'no_eligible_entitlement' // no package covers this class, or her credits ran out mid-series
  | 'calendar_day' // the owner chose to skip a marked day (a holiday, a closure) — D23

export interface RecurringTarget {
  readonly weekOffset: number // 1..weeks
  readonly date: string // 'YYYY-MM-DD' studio-local
  readonly sessionId: string
  readonly startsAt: Instant
  readonly entitlementId: string
  readonly entitlementName: string
}

export interface RecurringSkip {
  readonly weekOffset: number
  readonly date: string
  readonly sessionId: string | null
  readonly reason: RecurringSkipReason
}

export interface RecurringPlan {
  readonly toBook: readonly RecurringTarget[]
  readonly skipped: readonly RecurringSkip[]
}

export interface RecurringInput {
  readonly seed: ClassSession // the class she is already looking at — the slot to repeat
  readonly sessions: readonly ClassSession[] // every session in the target range (any status)
  readonly memberId: MemberId
  readonly memberReservations: readonly Reservation[] // hers, to detect an existing booking
  readonly entitlements: readonly Entitlement[] // hers, active
  readonly weeks: number
  readonly now: Instant
  readonly utcOffsetMinutes: number
  readonly skipDates: ReadonlySet<string> // D23 — days the owner ticked off
}

const WEEK_MS = 7 * 86_400_000

// Pure. The same slot, week after week: the SAME service at the SAME instant-of-week. Matching on
// the exact start time (not "some Tuesday class") is deliberate — a member who booked 09:00 did
// not agree to 18:30, and a generator that quietly retimes her is worse than one that skips.
export function computeRecurringPlan(input: RecurringInput): RecurringPlan {
  const toBook: RecurringTarget[] = []
  const skipped: RecurringSkip[] = []

  const bySlot = new Map<number, ClassSession>()
  for (const s of input.sessions) {
    if (s.serviceId === input.seed.serviceId) bySlot.set(s.startsAt, s)
  }
  const bookedSessionIds = new Set(
    input.memberReservations.filter((r) => r.status === 'booked').map((r) => r.classSessionId as string),
  )

  // Credits are consumed AS THE SERIES IS PLANNED, not after it. Otherwise a member with two
  // credits is promised eight classes and discovers the truth on the third one.
  const heldExtra = new Map<string, number>()
  const withSimulatedHolds = (): readonly Entitlement[] =>
    input.entitlements.map((e) => {
      const extra = heldExtra.get(e.id) ?? 0
      if (extra === 0 || e.credits === null) return e
      return { ...e, credits: { ...e.credits, held: e.credits.held + extra } }
    })

  for (let k = 1; k <= input.weeks; k++) {
    const startsAt = (input.seed.startsAt + k * WEEK_MS) as Instant
    const date = localDateAt(startsAt, input.utcOffsetMinutes) as string
    const session = bySlot.get(startsAt)

    if (input.skipDates.has(date)) {
      skipped.push({ weekOffset: k, date, sessionId: session?.id ?? null, reason: 'calendar_day' })
      continue
    }
    if (!session) {
      skipped.push({ weekOffset: k, date, sessionId: null, reason: 'no_session' })
      continue
    }
    if (session.status === 'cancelled') {
      skipped.push({ weekOffset: k, date, sessionId: session.id, reason: 'session_cancelled' })
      continue
    }
    if (session.startsAt <= input.now) {
      skipped.push({ weekOffset: k, date, sessionId: session.id, reason: 'session_in_past' })
      continue
    }
    if (bookedSessionIds.has(session.id)) {
      skipped.push({ weekOffset: k, date, sessionId: session.id, reason: 'already_booked' })
      continue
    }
    if (session.bookedCount >= session.capacity) {
      skipped.push({ weekOffset: k, date, sessionId: session.id, reason: 'session_full' })
      continue
    }

    // Same selection rule as any other booking (I-17): earliest-expiring first, deterministic.
    const candidates = withSimulatedHolds().filter((e) => {
      if (e.credits === null) return true
      return available(e.credits) >= 1
    })
    const chosen = selectEntitlement(candidates, session, input.now)
    if (!chosen) {
      skipped.push({ weekOffset: k, date, sessionId: session.id, reason: 'no_eligible_entitlement' })
      continue
    }
    if (chosen.credits !== null) heldExtra.set(chosen.id, (heldExtra.get(chosen.id) ?? 0) + 1)

    toBook.push({
      weekOffset: k,
      date,
      sessionId: session.id,
      startsAt,
      entitlementId: chosen.id,
      entitlementName: chosen.productSnapshot.name,
    })
  }

  return { toBook, skipped }
}
