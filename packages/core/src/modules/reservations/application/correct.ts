import {
  err,
  ok,
  type DomainError,
  type ReservationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideRestore } from '../../entitlements'
import type { AttendanceOutcome } from '../commands'
import { decideCorrection } from '../domain/decide'
import type { CreditEffect } from '../domain/types'
import { decideContext } from './context'
import type { ReservationsDeps, ResolveDecision } from './ports'

export interface CorrectReservationInput {
  readonly reservationId: ReservationId
  readonly toOutcome: AttendanceOutcome
  readonly reason: string // mandatory, enforced in the domain (AD-22)
}

// Correction overturns a RESOLVED outcome with a reason (owner/reception, Doc 2 §8).
// It is a compensating write, never a silent edit (non-negotiable #9): the original
// resolution stays in the log and `reservation.corrected` follows it. Moving a credit
// is trusted work, so this is a Server Action, not a `/commands` write.
//
// Credit compensation (v1.10): the only ledger direction wired is a credit coming
// BACK — a consumed credit is `restored` (the common, valuable case: a presumed-
// attended member who never came, DEBT-007). The reverse (re-consuming a released
// credit) has no held credit to draw from; its arithmetic is unresolved and owner-
// owned (DEBT-010), so it is refused, never guessed.
export async function correctReservation(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: CorrectReservationInput,
): Promise<Result<void, DomainError>> {
  const dctx = decideContext(deps, ctx)

  return deps.repo.resolve(ctx, {
    reservationId: input.reservationId,
    decide: (reservation, session, entitlement): Result<ResolveDecision, DomainError> => {
      const corrected = decideCorrection(dctx, reservation, input.toOutcome, input.reason)
      if (!corrected.ok) return corrected

      // A period entitlement never moves a credit — audit-only correction.
      if (entitlement.credits === null) {
        return ok({
          reservation: { ...corrected.value.reservation, creditEffect: 'none' },
          nextEntitlement: null,
          events: corrected.value.events,
        })
      }

      const policy = session.policySnapshot
      const current = reservation.creditEffect
      const desired: CreditEffect =
        input.toOutcome === 'attended' ? 'consumed' : policy.noShowConsumesCredit ? 'consumed' : 'released'

      // Same credit outcome → audit-only correction, no ledger movement.
      if (current === desired) {
        return ok({ reservation: corrected.value.reservation, nextEntitlement: null, events: corrected.value.events })
      }

      // The credit comes back: consumed → restored (restored++, consumed untouched, I-3).
      if (current === 'consumed' && desired === 'released') {
        const restored = decideRestore(dctx, entitlement, input.reservationId, input.reason)
        if (!restored.ok) return restored
        return ok({
          reservation: { ...corrected.value.reservation, creditEffect: 'released' },
          nextEntitlement: restored.value.next,
          events: [...corrected.value.events, ...restored.value.events],
        })
      }

      // The reverse — re-consume a released credit — is unresolved money arithmetic.
      return err({ code: 'correction_credit_unsupported' })
    },
  })
}
