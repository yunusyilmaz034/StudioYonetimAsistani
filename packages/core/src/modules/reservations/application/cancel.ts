import { ok, type DomainError, type ReservationId, type Result, type TenantContext } from '../../../shared'
import { decideConsume, decideRelease } from '../../entitlements'
import { decideCancellation } from '../domain/decide'
import { decideContext } from './context'
import type { CancelDecision, ReservationsDeps } from './ports'

export interface CancelReservationInput {
  readonly reservationId: ReservationId
}

// Cancellation moves a credit (release inside no counter; late-cancel may consume),
// so it is a Server-Action write. The transaction reads reservation + session +
// entitlement, composes decideCancellation with the matching ledger movement, and
// frees the seat (bookedCount − 1).
export async function cancelReservation(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: CancelReservationInput,
): Promise<Result<void, DomainError>> {
  const dctx = decideContext(deps, ctx)

  return deps.repo.cancel(ctx, {
    reservationId: input.reservationId,
    decide: (reservation, session, entitlement): Result<CancelDecision, DomainError> => {
      const cancelled = decideCancellation(dctx, reservation, session)
      if (!cancelled.ok) return cancelled

      const effect = cancelled.value.reservation.creditEffect
      const bookedCountAfter = Math.max(0, session.bookedCount - 1)
      const baseEvents = cancelled.value.events

      if (entitlement.credits === null || effect === 'none') {
        return ok({ reservation: cancelled.value.reservation, nextEntitlement: null, bookedCountAfter, events: baseEvents })
      }
      const ledger =
        effect === 'consumed'
          ? decideConsume(dctx, entitlement, input.reservationId, 'late_cancellation')
          : decideRelease(dctx, entitlement, input.reservationId, 'cancellation')
      if (!ledger.ok) return ledger
      return ok({
        reservation: cancelled.value.reservation,
        nextEntitlement: ledger.value.next,
        bookedCountAfter,
        events: [...baseEvents, ...ledger.value.events],
      })
    },
  })
}
