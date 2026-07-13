import type { ClassSessionId, DomainError, ReservationId, Result, TenantContext } from '../../../shared'
import { decideMove } from '../domain/decide'
import { decideContext } from './context'
import type { MoveDecision, ReservationsDeps } from './ports'

// D19 — move a reservation to another session. One event (`reservation.moved`), one hold, two
// seat counts. Never a cancel + a book: see `decideMove` for why that distinction is load-bearing.
export interface MoveReservationInput {
  readonly reservationId: ReservationId
  readonly targetSessionId: ClassSessionId
  // Staff moving a member past the free-move window must say why; the reason is stamped into the
  // event, where a dispute can read it.
  readonly overrideReason?: string | null
  readonly operationId?: import('../../../shared').OperationId
}

export async function moveReservation(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: MoveReservationInput,
): Promise<Result<void, DomainError>> {
  const dctx = decideContext(deps, ctx, input.operationId ? { operationId: input.operationId } : {})
  const hours = await deps.hours.getStudioHours(ctx)

  return deps.repo.move(ctx, {
    reservationId: input.reservationId,
    targetSessionId: input.targetSessionId,
    decide: (reservation, from, to, entitlement, memberHasBookedTarget): Result<MoveDecision, DomainError> => {
      const moved = decideMove(dctx, reservation, from, to, entitlement, memberHasBookedTarget, hours, {
        overrideReason: input.overrideReason ?? null,
      })
      if (!moved.ok) return moved
      return {
        ok: true,
        value: {
          reservation: moved.value.reservation,
          fromBookedCountAfter: Math.max(0, from.bookedCount - 1),
          toBookedCountAfter: to.bookedCount + 1,
          events: moved.value.events,
        },
      }
    },
  })
}
