import { newCorrelationId, type EventSource, type TenantContext } from '../../../shared'
import type { DecideContext } from '../domain/decide'
import type { ReservationsDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

// One context per command → one correlationId shared by every event the command
// emits (a booking writes reservation.booked AND entitlement.credit_held under the
// same correlationId — Doc 4 §74). Structurally compatible with the entitlements
// DecideContext, so the same object drives both modules' deciders.
export function decideContext(deps: ReservationsDeps, ctx: TenantContext): DecideContext {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: deps.clock.now(),
    correlationId: newCorrelationId(),
    source: SOURCE,
  }
}
