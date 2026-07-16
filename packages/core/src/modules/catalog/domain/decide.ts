import { changedFieldNames, diffFields } from '../../../shared'
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

// Generic edit. Carries the changed field NAMES (as it always has) and, since OQ-2, the before/
// after of each one — the Audit Log's "eski değer → yeni değer". Empty change ⇒ no event: an edit
// that changed nothing is not an event, it is a click.
const PRODUCT_FIELDS = [
  'name',
  'category',
  'type',
  'durationDays',
  'creditCount',
  'priceInKurus',
  'freezeAllowanceDays',
  'dailyReservationLimit',
  'cancellationAllowanceCount',
  'activeReservationLimit',
  'description',
  'active',
  'serviceIds',
] as const

export function decideUpdateProduct(ctx: DecideContext, current: Product, next: Product): NewEvent[] {
  const changes = diffFields(current, next, PRODUCT_FIELDS)
  if (changes.length === 0) return []
  return [
    {
      ...base(ctx, next.id),
      type: PRODUCT_UPDATED,
      payload: { changedFields: changedFieldNames(changes), changes },
    },
  ]
}
