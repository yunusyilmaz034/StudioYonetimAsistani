import {
  newCorrelationId,
  type CommandId,
  type EventSource,
  type Instant,
  type TenantContext,
} from '../../../shared'
import type { DecideContext } from '../domain/decide'
import type { CheckinDeps } from './ports'

export const RECEPTION_SOURCE: EventSource = 'reception_web'
export const SYSTEM_SWEEP_SOURCE: EventSource = 'system_sweep'

export interface DecideContextOptions {
  readonly source?: EventSource
  readonly now?: Instant
  readonly commandId?: CommandId | null
}

export function decideContext(
  deps: CheckinDeps,
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
