import { newCorrelationId, type CommandId, type EventSource, type Instant, type TenantContext } from '../../../shared'
import type { DecideContext } from '../domain/decide'
import type { ReservationsDeps } from './ports'

// `source` is metadata — what typed the event in (Doc 4 §"actor and source"). Domain
// logic never branches on it. The reception app (booking, cancellation, manual
// attendance) is `reception_web`; the nightly `system` sweep is `system_sweep`.
export const RECEPTION_SOURCE: EventSource = 'reception_web'
export const SYSTEM_SWEEP_SOURCE: EventSource = 'system_sweep'

export interface DecideContextOptions {
  // Metadata source; defaults to the reception app.
  readonly source?: EventSource
  // Domain time override. A same-request write (booking, cancel, correction) uses
  // the server clock; an offline command replays the instant the thing HAPPENED
  // (the command's clamped `occurredAt`), which is why the caller may pin `now`.
  readonly now?: Instant
  // The command that caused this write, when it came from the `/commands` path.
  readonly commandId?: CommandId | null
}

// One context per command → one correlationId shared by every event the command
// emits (a booking writes reservation.booked AND entitlement.credit_held under the
// same correlationId — Doc 4 §74). Structurally compatible with the entitlements
// DecideContext, so the same object drives both modules' deciders.
export function decideContext(
  deps: ReservationsDeps,
  ctx: TenantContext,
  opts: DecideContextOptions = {},
): DecideContext {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: opts.now ?? deps.clock.now(),
    correlationId: newCorrelationId(),
    source: opts.source ?? RECEPTION_SOURCE,
    commandId: opts.commandId ?? null,
  }
}
