import type {
  ActorRef,
  AggregateKind,
  CorrelationId,
  EventSource,
  Instant,
  NewEvent,
  StudioId,
} from '../../../shared'
import { PRODUCT_CREATED, PRODUCT_UPDATED } from '../events'
import type { Product } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(ctx: DecideContext, id: string) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind: 'product' as AggregateKind, id },
    related: {},
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

export function decideCreateProduct(ctx: DecideContext, p: Product): NewEvent[] {
  return [
    {
      ...base(ctx, p.id),
      type: PRODUCT_CREATED,
      payload: {
        name: p.name,
        category: p.category,
        type: p.type,
        durationDays: p.durationDays,
        creditCount: p.creditCount,
        priceInKurus: p.priceInKurus,
      },
    },
  ]
}

// Generic edit — carries the changed field names (deactivation is `active` changing).
// serviceIds compares by content. Empty change ⇒ no event.
export function decideUpdateProduct(ctx: DecideContext, current: Product, next: Product): NewEvent[] {
  const changedFields: string[] = []
  if (current.name !== next.name) changedFields.push('name')
  if (current.category !== next.category) changedFields.push('category')
  if (current.type !== next.type) changedFields.push('type')
  if (current.durationDays !== next.durationDays) changedFields.push('durationDays')
  if (current.creditCount !== next.creditCount) changedFields.push('creditCount')
  if (current.priceInKurus !== next.priceInKurus) changedFields.push('priceInKurus')
  if (current.freezeAllowanceDays !== next.freezeAllowanceDays) changedFields.push('freezeAllowanceDays')
  if (current.dailyReservationLimit !== next.dailyReservationLimit) changedFields.push('dailyReservationLimit')
  if (current.cancellationAllowanceCount !== next.cancellationAllowanceCount) changedFields.push('cancellationAllowanceCount')
  if (current.description !== next.description) changedFields.push('description')
  if (current.active !== next.active) changedFields.push('active')
  if (current.serviceIds.join(',') !== next.serviceIds.join(',')) changedFields.push('serviceIds')
  if (changedFields.length === 0) return []
  return [{ ...base(ctx, next.id), type: PRODUCT_UPDATED, payload: { changedFields } }]
}
