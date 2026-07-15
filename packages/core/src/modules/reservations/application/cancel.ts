import {
  ok,
  type DomainError,
  type OperationId,
  type ReservationId,
  type ReservationOverride,
  type Result,
  type TenantContext,
} from '../../../shared'
import { cancellationsUsed, decideChargeCancellation, decideConsume, decideRelease } from '../../entitlements'
import { decideCancellation } from '../domain/decide'
import { packageRuleFromSnapshot, resolveReservationPolicy } from '../domain/policy'
import { decideContext } from './context'
import type { CancelDecision, ReservationsDeps } from './ports'

export interface CancelReservationInput {
  readonly reservationId: ReservationId
  // OP-2 — the operation this cancellation belongs to (a closure, a bulk act). Omitted when a
  // human cancelled one reservation: that is its own operation.
  readonly operationId?: OperationId
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
  const dctx = decideContext(deps, ctx, input.operationId ? { operationId: input.operationId } : {})

  // Package Rules 2.0 — the member's override is loaded before the transaction (one extra read on the
  // cool cancel path). Only a MEMBER/reception cancel spends her free-cancellation allowance; a bulk /
  // studio cancellation goes through a different path and never charges her.
  const existing = await deps.repo.getReservation(ctx, input.reservationId)
  const override: ReservationOverride | null =
    deps.policy && existing ? await deps.policy.getMemberOverride(ctx, existing.memberId) : null

  return deps.repo.cancel(ctx, {
    reservationId: input.reservationId,
    decide: (reservation, session, entitlement): Result<CancelDecision, DomainError> => {
      const eff = resolveReservationPolicy(packageRuleFromSnapshot(entitlement.productSnapshot), override)
      const cancelled = decideCancellation(dctx, reservation, session, {
        allowance: eff.cancellationAllowance,
        usedNet: cancellationsUsed(entitlement.cancellationLedger),
      })
      if (!cancelled.ok) return cancelled

      const effect = cancelled.value.reservation.creditEffect
      const bookedCountAfter = Math.max(0, session.bookedCount - 1)
      let nextEntitlement = null as CancelDecision['nextEntitlement']
      let events = [...cancelled.value.events]

      // Credit movement (release / late-consume). Period bookings hold nothing.
      if (entitlement.credits !== null && effect !== 'none') {
        const ledger =
          effect === 'consumed'
            ? decideConsume(dctx, entitlement, input.reservationId, 'late_cancellation')
            : decideRelease(dctx, entitlement, input.reservationId, 'cancellation')
        if (!ledger.ok) return ledger
        nextEntitlement = ledger.value.next
        events = [...events, ...ledger.value.events]
      }

      // Free-cancellation allowance charge — independent of the credit move (it applies even to a
      // period package that somehow carries a finite allowance). One per in-window cancel.
      if (cancelled.value.allowanceConsumed) {
        const charge = decideChargeCancellation(dctx, nextEntitlement ?? entitlement, input.reservationId)
        nextEntitlement = charge.next
        events = [...events, ...charge.events]
      }

      return ok({ reservation: cancelled.value.reservation, nextEntitlement, bookedCountAfter, events })
    },
  })
}
