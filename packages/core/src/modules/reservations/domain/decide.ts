import {
  err,
  hoursBetween,
  ok,
  type ActorRef,
  type AggregateKind,
  type CommandId,
  type CorrelationId,
  type DomainError,
  type EventRelated,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type PolicyId,
  type PolicyRef,
  type ReservationId,
  type Result,
  type StudioId,
} from '../../../shared'
import type { ClassSession, SchedulingPolicy } from '../../scheduling'
import { available, type Entitlement } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import {
  RESERVATION_ATTENDED,
  RESERVATION_AUTO_RESOLVED,
  RESERVATION_BOOKED,
  RESERVATION_CANCELLED,
  RESERVATION_CORRECTED,
  RESERVATION_LATE_CANCELLED,
  RESERVATION_NO_SHOW,
  RESERVATION_NOTE_SET,
} from '../events'
import type { CreditEffect, Reservation, ReservationStatus } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
  // The command that caused this event, when it came from the `/commands` path
  // (offline attendance marking). null for synchronous Server-Action writes.
  readonly commandId?: CommandId | null
}

export type ReservationOutcome = { readonly reservation: Reservation; readonly events: readonly NewEvent[] }

function policyRefOf(r: Reservation): PolicyRef {
  return { policyId: r.policyRef.policyId as PolicyId, version: r.policyRef.version }
}

function base(ctx: DecideContext, r: Reservation) {
  const related: EventRelated = {
    memberId: r.memberId,
    entitlementId: r.entitlementId,
    classSessionId: r.classSessionId,
    reservationId: r.id,
  }
  return {
    studioId: ctx.studioId,
    branchId: r.branchId,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind: 'reservation' as AggregateKind, id: r.id },
    related,
    policyRef: policyRefOf(r),
    commandId: ctx.commandId ?? null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

const availableOf = (e: Entitlement): number | null => (e.credits ? available(e.credits) : null)

// ── Booking (I-9, all seven preconditions; I-10 transaction is the application's).
//    Holds a credit — available drops immediately (E1). ──
export interface BookInput {
  readonly reservationId: ReservationId // minted in the application (domain stays pure)
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot
}

export function decideBooking(
  ctx: DecideContext,
  session: ClassSession,
  entitlement: Entitlement,
  input: BookInput,
  memberHasBookedThisSession: boolean,
): Result<ReservationOutcome, DomainError> {
  // I-9.1
  if (session.status !== 'scheduled' || session.startsAt <= ctx.now) {
    return err({ code: 'session_not_bookable' })
  }
  // I-9.2
  if (session.bookedCount >= session.capacity) {
    return err({ code: 'class_full', capacity: session.capacity })
  }
  // I-9.3
  if (entitlement.status !== 'active') return err({ code: 'entitlement_not_active' })
  // I-9.4
  if (session.startsAt > entitlement.validUntil) {
    return err({ code: 'entitlement_expires_before_session' })
  }
  // I-9.5
  const avail = availableOf(entitlement)
  if (avail !== null && avail < 1) return err({ code: 'insufficient_credits', available: avail })
  // I-9.6
  if (memberHasBookedThisSession) return err({ code: 'already_booked' })
  // I-9.7 — the category wall
  if (entitlement.productSnapshot.category !== session.category) {
    return err({
      code: 'category_mismatch',
      sessionCategory: session.category,
      entitlementCategory: entitlement.productSnapshot.category,
    })
  }

  const isCredit = entitlement.credits !== null
  const creditEffect: CreditEffect = isCredit ? 'held' : 'none'
  const creditsAvailableAfter = avail === null ? null : avail - 1

  const reservation: Reservation = {
    id: input.reservationId,
    studioId: ctx.studioId,
    branchId: session.branchId,
    classSessionId: session.id,
    memberId: input.memberId,
    entitlementId: entitlement.id,
    status: 'booked',
    creditEffect,
    sessionStartsAt: session.startsAt,
    sessionEndsAt: session.endsAt,
    sessionCategory: session.category,
    memberSnapshot: input.memberSnapshot,
    bookedAt: ctx.now,
    bookedBy: ctx.actor,
    resolvedAt: null,
    resolvedBy: null,
    attendanceSource: null,
    policyRef: { policyId: session.policyRef.serviceId, version: session.policyRef.version },
  }

  return ok({
    reservation,
    events: [
      {
        ...base(ctx, reservation),
        type: RESERVATION_BOOKED,
        payload: {
          entitlementId: entitlement.id,
          creditEffect,
          creditsAvailableAfter,
          sessionStartsAt: session.startsAt,
          bookedCountAfter: session.bookedCount + 1,
        },
      },
    ],
  })
}

// ── Cancellation (Doc 2 §7.2). Pure: the six-hour window is `policy.cancellation
//    WindowHours`; nothing knows the number six. A studio-cancelled class always
//    releases (I-14). ──
export function decideCancellation(
  ctx: DecideContext,
  reservation: Reservation,
  session: ClassSession,
): Result<ReservationOutcome, DomainError> {
  if (reservation.status !== 'booked') return err({ code: 'reservation_not_open' })
  const policy: SchedulingPolicy = session.policySnapshot
  const hoursBeforeStart = hoursBetween(ctx.now, session.startsAt)
  // A period booking never held a credit (creditEffect 'none'); cancelling it moves
  // nothing regardless of the window.
  const heldACredit = reservation.creditEffect !== 'none'

  // Studio-cancelled class → always release the held credit, unconditionally (I-14).
  if (session.status === 'cancelled') {
    const effect: CreditEffect = heldACredit ? 'released' : 'none'
    return ok(resolveCancel(ctx, reservation, hoursBeforeStart, true, effect, 'cancelled'))
  }

  if (hoursBeforeStart >= policy.cancellationWindowHours) {
    const effect: CreditEffect = heldACredit ? 'released' : 'none'
    return ok(resolveCancel(ctx, reservation, hoursBeforeStart, true, effect, 'cancelled'))
  }
  // Inside the window: late cancel. Burns per policy; otherwise the hold is released
  // (a resolved reservation can never keep a hold — I-2).
  const effect: CreditEffect = !heldACredit
    ? 'none'
    : policy.lateCancellationConsumesCredit
      ? 'consumed'
      : 'released'
  return ok(resolveCancel(ctx, reservation, hoursBeforeStart, false, effect, 'late_cancelled'))
}

function resolveCancel(
  ctx: DecideContext,
  reservation: Reservation,
  hoursBeforeStart: number,
  withinWindow: boolean,
  creditEffect: CreditEffect,
  status: 'cancelled' | 'late_cancelled',
): ReservationOutcome {
  const next: Reservation = {
    ...reservation,
    status,
    creditEffect,
    resolvedAt: ctx.now,
    resolvedBy: ctx.actor,
  }
  return {
    reservation: next,
    events: [
      {
        ...base(ctx, next),
        type: status === 'cancelled' ? RESERVATION_CANCELLED : RESERVATION_LATE_CANCELLED,
        payload: { hoursBeforeStart, withinWindow, creditEffect },
      },
    ],
  }
}

// ── Manual attendance marking (source: trainer). A confirmation/override, never the
//    primary source (§8). No-show burns per policy. ──
export function decideAttendance(
  ctx: DecideContext,
  reservation: Reservation,
  session: ClassSession,
  outcome: 'attended' | 'no_show',
): Result<ReservationOutcome, DomainError> {
  if (reservation.status !== 'booked') return err({ code: 'reservation_not_open' })
  const policy: SchedulingPolicy = session.policySnapshot
  // A period booking held no credit (creditEffect 'none'); resolving it moves nothing,
  // and the event must say so — a `reservation.attended` claiming `consumed` for an
  // unlimited membership is a false fact in the log (mirrors decideCancellation).
  const heldACredit = reservation.creditEffect !== 'none'

  if (outcome === 'attended') {
    const minutesAfterStart = Math.max(0, Math.floor((ctx.now - session.startsAt) / 60_000))
    const effect: CreditEffect = heldACredit ? 'consumed' : 'none'
    const next = resolveAttendance(ctx, reservation, 'attended', effect, 'trainer')
    return ok({
      reservation: next.reservation,
      events: [
        {
          ...base(ctx, next.reservation),
          type: RESERVATION_ATTENDED,
          payload: { source: 'trainer', minutesAfterStart, creditEffect: effect },
        },
      ],
    })
  }
  const effect: CreditEffect = !heldACredit ? 'none' : policy.noShowConsumesCredit ? 'consumed' : 'released'
  const next = resolveAttendance(ctx, reservation, 'no_show', effect, 'trainer')
  return ok({
    reservation: next.reservation,
    events: [
      {
        ...base(ctx, next.reservation),
        type: RESERVATION_NO_SHOW,
        payload: { source: 'trainer', creditEffect: effect },
      },
    ],
  })
}

// ── Auto-resolution (actor: system). Emits `reservation.auto_resolved` with
//    source `system_default` — NEVER `reservation.attended` (I-18, AD-38). The
//    outcome is `policy.attendanceDefaultOutcome`; nothing knows what this studio
//    believes (D3). ──
export function decideAutoResolution(
  ctx: DecideContext,
  reservation: Reservation,
  session: ClassSession,
  entitlement: Entitlement,
): Result<ReservationOutcome, DomainError> {
  if (reservation.status !== 'booked') return err({ code: 'reservation_not_open' })
  const policy: SchedulingPolicy = session.policySnapshot
  // The presumption may only be written once the class has ended AND the grace
  // window has elapsed (Doc 2 §8: `session.endsAt + autoResolveAfterMinutes`).
  // Enforced here, purely, so a marker (trainer/reception) always owns the window
  // before the `system` default claims it — and so a tighter sweep cadence can
  // never resolve a class that just ended. `exactly grace` is eligible; one ms less
  // is not. Nothing in the code knows how many minutes: it is policy data (D3).
  const resolvableAt = session.endsAt + policy.autoResolveAfterMinutes * 60_000
  if (ctx.now < resolvableAt) return err({ code: 'auto_resolve_too_early', resolvableAt })
  const outcome = policy.attendanceDefaultOutcome
  // A period booking held nothing → the resolution moves no credit (see decideAttendance).
  const heldACredit = reservation.creditEffect !== 'none'
  const effect: CreditEffect = !heldACredit
    ? 'none'
    : outcome === 'attended'
      ? 'consumed'
      : policy.noShowConsumesCredit
        ? 'consumed'
        : 'released'

  const next = resolveAttendance(ctx, reservation, outcome, effect, 'system_default')
  const avail = availableOf(entitlement)
  const creditsAvailableAfter = effect === 'released' && avail !== null ? avail + 1 : avail

  return ok({
    reservation: next.reservation,
    events: [
      {
        ...base(ctx, next.reservation),
        type: RESERVATION_AUTO_RESOLVED,
        payload: { outcome, source: 'system_default', creditEffect: effect, creditsAvailableAfter },
      },
    ],
  })
}

function resolveAttendance(
  ctx: DecideContext,
  reservation: Reservation,
  status: 'attended' | 'no_show',
  creditEffect: CreditEffect,
  attendanceSource: 'trainer' | 'system_default',
): ReservationOutcome {
  const next: Reservation = {
    ...reservation,
    status,
    creditEffect,
    resolvedAt: ctx.now,
    resolvedBy: ctx.actor,
    attendanceSource,
  }
  return { reservation: next, events: [] }
}

// ── Correction (owner/reception overturns a resolved outcome, with a reason).
//    Compensating event only — never a silent edit (D5, I-3). The credit
//    compensation is composed by the application (v1.10). ──
const RESOLVED_STATES: readonly ReservationStatus[] = [
  'attended',
  'no_show',
  'cancelled',
  'late_cancelled',
]

export function decideCorrection(
  ctx: DecideContext,
  reservation: Reservation,
  toStatus: ReservationStatus,
  reason: string,
): Result<ReservationOutcome, DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  // A correction overturns a RESOLVED outcome (Doc 2 §8). A still-`booked`
  // reservation is cancelled or marked, never "corrected" — there is no outcome to
  // overturn yet, and its credit is still `held`, not settled.
  if (!RESOLVED_STATES.includes(reservation.status)) {
    return err({ code: 'reservation_not_resolved' })
  }
  const from = reservation.status
  const next: Reservation = {
    ...reservation,
    status: toStatus,
    attendanceSource: 'correction',
    resolvedAt: ctx.now,
    resolvedBy: ctx.actor,
  }
  return ok({
    reservation: next,
    events: [
      {
        ...base(ctx, next),
        type: RESERVATION_CORRECTED,
        payload: { from, to: toStatus, reason, source: 'correction' },
      },
    ],
  })
}

// Set (or clear) the staff quick note (Hızlı Not). Free text preserved, trimmed at the
// edges; empty text clears it. Staff metadata — allowed on any reservation status. The
// application applies the note to the reservation state alongside this event.
export function decideSetReservationNote(
  ctx: DecideContext,
  reservation: Reservation,
  text: string,
): Result<NewEvent[], DomainError> {
  return ok([
    {
      ...base(ctx, reservation),
      type: RESERVATION_NOTE_SET,
      payload: { text: text.trim() },
    },
  ])
}
