import { newCorrelationId, type EventSource, type TenantContext } from '../../../shared'
import type { DecideContext } from '../domain/decide'
import type { CatalogDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

export function decideContext(deps: CatalogDeps, ctx: TenantContext): DecideContext {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: deps.clock.now(),
    correlationId: newCorrelationId(),
    source: SOURCE,
  }
}
