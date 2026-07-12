import {
  newOperationId,
  type EntitlementId,
  type EventSource,
  type OperationId,
  type TenantContext,
} from '../../../shared'
import type { DecideContext } from '../domain/decide'
import type { Entitlement } from '../domain/types'
import type { EntitlementsDeps } from './ports'

// Metadata only — domain logic never branches on it. Reception app writes (purchase,
// adjust, cancel) are `reception_web`; the nightly `system` expiry sweep is `system_sweep`.
export const RECEPTION_SOURCE: EventSource = 'reception_web'
export const SYSTEM_SWEEP_SOURCE: EventSource = 'system_sweep'

export function decideContext(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  source: EventSource = RECEPTION_SOURCE,
  operationId?: OperationId, // OP-2 — set when this write belongs to a larger operation
): DecideContext {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: deps.clock.now(),
    correlationId: operationId ?? newOperationId(),
    source,
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
