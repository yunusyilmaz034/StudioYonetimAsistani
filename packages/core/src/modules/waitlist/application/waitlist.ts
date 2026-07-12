import {
  newOperationId,
  newWaitlistEntryId,
  type ClassSessionId,
  type DomainError,
  type EntitlementId,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import { bookReservation, selectEntitlement, type ReservationsDeps } from '../../reservations'
import type { ClassSession, SchedulingDeps } from '../../scheduling'
import { decideJoin, decideLeave, decidePromote, type DecideContext } from '../domain/decide'
import { byQueueOrder, type WaitlistEntry } from '../domain/types'
import type { WaitlistDeps } from './ports'

// D20 — the waiting list's application layer. Joining writes ONE document and ONE event, and
// moves no credit (I-29). Promotion is two acts under one operation id: an ordinary booking
// (which holds the credit, checks the walls, and may refuse) and then the entry's promotion.
// If the booking is refused, the entry stays `waiting` — she keeps her place in the queue.

const SOURCE = 'reception_web'
const dctx = (deps: WaitlistDeps, ctx: TenantContext, correlationId = newOperationId()): DecideContext => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId,
  source: SOURCE,
})

export interface WaitlistJoinInput {
  readonly sessionId: ClassSessionId
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot
}

export async function joinWaitlist(
  deps: WaitlistDeps & { scheduling: SchedulingDeps; hasBooking: (sessionId: ClassSessionId, memberId: MemberId) => Promise<boolean> },
  ctx: TenantContext,
  input: WaitlistJoinInput,
): Promise<Result<{ entryId: string }, DomainError>> {
  const session = await deps.scheduling.repo.getSession(ctx, input.sessionId)
  if (!session) return { ok: false, error: { code: 'waitlist_not_open' } }

  const queue = await deps.repo.listBySession(ctx, input.sessionId)
  const waiting = queue.filter((e) => e.status === 'waiting')
  const alreadyWaiting = waiting.some((e) => e.memberId === input.memberId)
  const alreadyBooked = await deps.hasBooking(input.sessionId, input.memberId)

  const decided = decideJoin(
    dctx(deps, ctx),
    session,
    {
      entryId: newWaitlistEntryId(),
      memberId: input.memberId,
      memberSnapshot: input.memberSnapshot,
      queueLength: waiting.length,
    },
    alreadyBooked,
    alreadyWaiting,
  )
  if (!decided.ok) return decided
  await deps.repo.save(ctx, decided.value.entry, decided.value.events)
  return { ok: true, value: { entryId: decided.value.entry.id } }
}

export async function leaveWaitlist(
  deps: WaitlistDeps,
  ctx: TenantContext,
  input: { entryId: string; reason: 'member' | 'staff' },
): Promise<Result<void, DomainError>> {
  const entry = await deps.repo.getEntry(ctx, input.entryId)
  if (!entry) return { ok: false, error: { code: 'waitlist_not_open' } }
  const decided = decideLeave(dctx(deps, ctx), entry, input.reason)
  if (!decided.ok) return decided
  await deps.repo.save(ctx, decided.value.entry, decided.value.events)
  return { ok: true, value: undefined }
}

export interface PromoteDeps extends WaitlistDeps {
  readonly scheduling: SchedulingDeps
  readonly reservations: ReservationsDeps
  readonly loadEntitlements: (ctx: TenantContext, memberId: MemberId) => Promise<readonly Entitlement[]>
}

// Manual promotion (owner decision, Doc 22 §4): reception decides, and tells her. The queue's
// FIFO order is offered to the UI — `nextInQueue` — but the act is a human's.
export function nextInQueue(entries: readonly WaitlistEntry[]): WaitlistEntry | null {
  return [...entries].filter((e) => e.status === 'waiting').sort(byQueueOrder)[0] ?? null
}

export async function promoteFromWaitlist(
  deps: PromoteDeps,
  ctx: TenantContext,
  input: { entryId: string },
): Promise<Result<{ reservationId: string }, DomainError>> {
  const entry = await deps.repo.getEntry(ctx, input.entryId)
  if (!entry) return { ok: false, error: { code: 'waitlist_not_open' } }
  if (entry.status !== 'waiting') return { ok: false, error: { code: 'waitlist_not_open' } }

  const session: ClassSession | null = await deps.scheduling.repo.getSession(ctx, entry.classSessionId)
  if (!session) return { ok: false, error: { code: 'session_not_bookable' } }

  const candidates = await deps.loadEntitlements(ctx, entry.memberId)
  const chosen = selectEntitlement(candidates, session, deps.clock.now())
  if (!chosen) return { ok: false, error: { code: 'no_bookable_entitlement' } }

  // OP-2 — the booking and the promotion are ONE operation.
  const operationId = newOperationId()

  // The booking runs first and may refuse (the seat vanished again, her credits ran out). If it
  // does, she stays in the queue — losing her place because reception was one second late would
  // be the cruellest possible bug.
  const booked = await bookReservation(deps.reservations, ctx, {
    sessionId: entry.classSessionId,
    entitlementId: chosen.id as EntitlementId,
    memberId: entry.memberId,
    memberSnapshot: entry.memberSnapshot,
    operationId,
  })
  if (!booked.ok) return booked

  const decided = decidePromote(dctx(deps, ctx, operationId), entry, booked.value.reservationId)
  if (!decided.ok) return decided
  await deps.repo.save(ctx, decided.value.entry, decided.value.events)
  return { ok: true, value: { reservationId: booked.value.reservationId } }
}
