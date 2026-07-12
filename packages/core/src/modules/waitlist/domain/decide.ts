import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type ReservationId,
  type Result,
  type StudioId,
} from '../../../shared'
import type { MemberSnapshot } from '../../members'
import type { ClassSession } from '../../scheduling'
import { WAITLIST_JOINED, WAITLIST_LEFT, WAITLIST_PROMOTED } from '../events'
import type { WaitlistEntry } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

export type WaitlistOutcome = { readonly entry: WaitlistEntry; readonly events: readonly NewEvent[] }

function base(ctx: DecideContext, e: WaitlistEntry) {
  return {
    studioId: ctx.studioId,
    branchId: e.branchId,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind: 'reservation' as AggregateKind, id: e.id },
    related: { memberId: e.memberId, classSessionId: e.classSessionId },
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

export interface JoinInput {
  readonly entryId: string
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot
  readonly queueLength: number // waiting entries already in the queue
}

// Waiting is only meaningful for a FULL, future, live class. A member standing in a queue for a
// class with three empty seats is a bug that looks like a feature: she waits, nobody promotes
// her, and she blames the studio for a seat that was there all along.
export function decideJoin(
  ctx: DecideContext,
  session: ClassSession,
  input: JoinInput,
  alreadyBooked: boolean,
  alreadyWaiting: boolean,
): Result<WaitlistOutcome, DomainError> {
  if (session.status !== 'scheduled' || session.startsAt <= ctx.now) {
    return err({ code: 'waitlist_not_open' })
  }
  if (session.bookedCount < session.capacity) return err({ code: 'waitlist_not_open' })
  if (alreadyBooked) return err({ code: 'already_booked' })
  if (alreadyWaiting) return err({ code: 'already_waitlisted' })

  const entry: WaitlistEntry = {
    id: input.entryId,
    studioId: ctx.studioId,
    branchId: session.branchId,
    classSessionId: session.id,
    memberId: input.memberId,
    memberSnapshot: input.memberSnapshot,
    status: 'waiting',
    joinedAt: ctx.now,
    joinedBy: ctx.actor,
    resolvedAt: null,
    reservationId: null,
  }
  return ok({
    entry,
    events: [
      {
        ...base(ctx, entry),
        type: WAITLIST_JOINED,
        payload: {
          sessionStartsAt: session.startsAt,
          position: input.queueLength + 1,
          creditEffect: 'none', // I-29
        },
      },
    ],
  })
}

export function decideLeave(
  ctx: DecideContext,
  entry: WaitlistEntry,
  reason: 'member' | 'staff' | 'session_started',
): Result<WaitlistOutcome, DomainError> {
  if (entry.status !== 'waiting') return err({ code: 'waitlist_not_open' })
  const next: WaitlistEntry = {
    ...entry,
    status: reason === 'session_started' ? 'expired' : 'left',
    resolvedAt: ctx.now,
  }
  return ok({ entry: next, events: [{ ...base(ctx, next), type: WAITLIST_LEFT, payload: { reason } }] })
}

// Promotion records that the queue produced a booking. The BOOKING itself is an ordinary
// reservation, made by the reservations module with its ordinary hold — this decider never
// touches a credit, which is the whole of I-29.
export function decidePromote(
  ctx: DecideContext,
  entry: WaitlistEntry,
  reservationId: ReservationId,
): Result<WaitlistOutcome, DomainError> {
  if (entry.status !== 'waiting') return err({ code: 'waitlist_not_open' })
  const next: WaitlistEntry = {
    ...entry,
    status: 'promoted',
    resolvedAt: ctx.now,
    reservationId,
  }
  return ok({
    entry: next,
    events: [
      {
        ...base(ctx, next),
        type: WAITLIST_PROMOTED,
        payload: {
          reservationId,
          waitedMinutes: Math.max(0, Math.floor((ctx.now - entry.joinedAt) / 60_000)),
        },
      },
    ],
  })
}
