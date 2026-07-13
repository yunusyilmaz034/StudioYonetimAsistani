import {
  newOperationId,
  newReservationId,
  ok,
  type ClassSessionId,
  type DomainError,
  type EntitlementId,
  type MemberId,
  type OperationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideHold, type Entitlement } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import type { ClassSession } from '../../scheduling'
import { decideBooking } from '../domain/decide'
import { computeRecurringPlan, type RecurringPlan } from '../domain/recurring'
import { decideContext } from './context'
import type { BookDecision, ReservationsDeps } from './ports'
import type { Reservation } from '../domain/types'

// D18 — the recurring booking's application layer. OP-5: `previewRecurring` WRITES NOTHING;
// `applyRecurring` re-derives from a fresh read and books each week as its own ordinary
// reservation — one transaction each, all under ONE operation id (OP-2), so eight bookings read
// as one act in the Activity Center and can be undone as one later (OP-4).

export interface RecurringWorld {
  readonly seed: ClassSession
  readonly sessions: readonly ClassSession[]
  readonly entitlements: readonly Entitlement[]
  readonly memberReservations: readonly Reservation[]
  readonly memberSnapshot: MemberSnapshot
}

export interface RecurringDeps extends ReservationsDeps {
  readonly utcOffsetMinutes: number
  readonly loadWorld: (
    ctx: TenantContext,
    memberId: MemberId,
    sessionId: ClassSessionId,
    weeks: number,
  ) => Promise<RecurringWorld | null>
}

export interface RecurringInputDto {
  readonly memberId: MemberId
  readonly sessionId: ClassSessionId // the slot to repeat
  readonly weeks: number
  readonly skipDates?: readonly string[] // D23 — marked days the owner ticked off
}

export interface RecurringSummary {
  readonly booked: number
  readonly failed: number
  readonly operationId: OperationId
  readonly plan: RecurringPlan
}

async function plan(
  deps: RecurringDeps,
  ctx: TenantContext,
  input: RecurringInputDto,
): Promise<{ world: RecurringWorld; plan: RecurringPlan } | null> {
  const world = await deps.loadWorld(ctx, input.memberId, input.sessionId, input.weeks)
  if (!world) return null
  return {
    world,
    plan: computeRecurringPlan({
      seed: world.seed,
      sessions: world.sessions,
      memberId: input.memberId,
      memberReservations: world.memberReservations,
      entitlements: world.entitlements,
      weeks: input.weeks,
      now: deps.clock.now(),
      utcOffsetMinutes: deps.utcOffsetMinutes,
      skipDates: new Set(input.skipDates ?? []),
    }),
  }
}

export async function previewRecurring(
  deps: RecurringDeps,
  ctx: TenantContext,
  input: RecurringInputDto,
): Promise<RecurringPlan | null> {
  const planned = await plan(deps, ctx, input)
  return planned?.plan ?? null
}

export async function applyRecurring(
  deps: RecurringDeps,
  ctx: TenantContext,
  input: RecurringInputDto,
): Promise<Result<RecurringSummary, DomainError>> {
  const planned = await plan(deps, ctx, input)
  if (!planned) return { ok: false, error: { code: 'session_not_bookable' } }

  // OP-2 — one id for the whole series.
  const operationId = newOperationId()
  const dctx = decideContext(deps, ctx, { operationId })

  let booked = 0
  let failed = 0
  const hours = await deps.hours.getStudioHours(ctx)

  for (const t of planned.plan.toBook) {
    const reservationId = newReservationId()
    const res = await deps.repo.book(ctx, {
      sessionId: t.sessionId as ClassSessionId,
      entitlementId: t.entitlementId as EntitlementId,
      memberId: input.memberId,
      decide: (session, entitlement, memberHasBooked): Result<BookDecision, DomainError> => {
        const decided = decideBooking(
          dctx,
          session,
          entitlement,
          { reservationId, memberId: input.memberId, memberSnapshot: planned.world.memberSnapshot },
          memberHasBooked,
          hours,
        )
        if (!decided.ok) return decided
        const held = decideHold(dctx, entitlement, reservationId)
        if (!held.ok) return held
        return ok({
          reservation: decided.value.reservation,
          nextEntitlement: held.value.next,
          bookedCountAfter: session.bookedCount + 1,
          events: [...decided.value.events, ...held.value.events],
        })
      },
    })
    // A week that loses its seat between the preview and the write is a FAILURE, not a silent
    // omission: the caller reports `failed` beside `booked`, and the plan says which weeks.
    if (res.ok) booked++
    else failed++
  }

  return { ok: true, value: { booked, failed, operationId, plan: planned.plan } }
}
