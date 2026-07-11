import {
  clampOccurredAt,
  ok,
  type CommandId,
  type DomainError,
  type Instant,
  type ReservationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideConsume, decideRelease } from '../../entitlements'
import type { AttendanceOutcome } from '../commands'
import { decideAttendance } from '../domain/decide'
import { decideContext } from './context'
import type { ReservationsDeps, ResolveDecision } from './ports'

export interface MarkAttendanceInput {
  readonly reservationId: ReservationId
  readonly outcome: AttendanceOutcome
  // Domain time the mark actually happened — supplied by the command, possibly
  // offline and minutes ago. Clamped so it can never precede `recordedAt` (#3).
  readonly occurredAt: Instant
  // The command being applied — stamped onto every event it causes (causation).
  readonly commandId: CommandId
}

// Manual attendance marking, applied from the `/commands` path by `on-command-created`
// (AD-57). The marking principal (trainer/receptionist) is the actor — never `system`
// (non-negotiable #5, #11). One transaction resolves the reservation and consumes or
// releases the held credit; the seat count is untouched (a resolved booking still
// happened). Idempotent by construction: a re-applied command hits a no-longer-`booked`
// reservation and `decideAttendance` refuses with `reservation_not_open`.
export async function markAttendance(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: MarkAttendanceInput,
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now()
  const dctx = decideContext(deps, ctx, {
    now: clampOccurredAt(input.occurredAt, now),
    commandId: input.commandId,
  })

  return deps.repo.resolve(ctx, {
    reservationId: input.reservationId,
    decide: (reservation, session, entitlement): Result<ResolveDecision, DomainError> => {
      const marked = decideAttendance(dctx, reservation, session, input.outcome)
      if (!marked.ok) return marked

      const effect = marked.value.reservation.creditEffect
      const baseEvents = marked.value.events
      if (entitlement.credits === null || effect === 'none') {
        return ok({ reservation: marked.value.reservation, nextEntitlement: null, events: baseEvents })
      }
      const ledger =
        effect === 'consumed'
          ? decideConsume(dctx, entitlement, input.reservationId, input.outcome)
          : decideRelease(dctx, entitlement, input.reservationId, input.outcome)
      if (!ledger.ok) return ledger
      return ok({
        reservation: marked.value.reservation,
        nextEntitlement: ledger.value.next,
        events: [...baseEvents, ...ledger.value.events],
      })
    },
  })
}
