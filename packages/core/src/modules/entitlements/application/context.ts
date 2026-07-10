import { newCorrelationId, type EntitlementId, type EventSource, type TenantContext } from '../../../shared'
import type { DecideContext } from '../domain/decide'
import type { Entitlement } from '../domain/types'
import type { EntitlementsDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

export function decideContext(deps: EntitlementsDeps, ctx: TenantContext): DecideContext {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: deps.clock.now(),
    correlationId: newCorrelationId(),
    source: SOURCE,
  }
}

export async function loadEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  id: EntitlementId,
): Promise<Entitlement> {
  const e = await deps.repo.getEntitlement(ctx, id)
  if (!e) throw new Error(`Entitlement not found: ${id}`)
  return e
}
