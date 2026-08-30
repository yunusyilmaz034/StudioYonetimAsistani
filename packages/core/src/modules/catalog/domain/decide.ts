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
        // Only stamped for a bundle — a normal product's payload is byte-for-byte unchanged (golden).
        ...(p.components && p.components.length > 0 ? { components: p.components } : {}),
        // Only stamped when opted in — an off product's payload stays byte-for-byte unchanged (golden).
        ...(p.onlineSellable ? { onlineSellable: true } : {}),
        ...(p.memberSellable ? { memberSellable: true } : {}),
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
  // NAKİT FİYAT VE GİRİŞ HAKKI DA İZLENİYOR (2026-08-30).
  //
  // Bu ikisi listede yoktu ve sonucu sessizdi: yalnızca nakit fiyatı değiştiren bir kayıt hiçbir
  // olay üretmiyor, `updateProduct` "değişen bir şey yok" deyip HİÇ YAZMIYOR, form ise
  // "kaydedildi" diyordu. Owner sekiz ürünün nakit fiyatını girdi, bir kısmı tutmadı ve sebebi
  // görünmüyordu. Kart/nakit farkı satış tutarını belirliyor — sessizce yok sayılacak bir alan değil.
  'cashPriceInKurus',
  'entryAllowance',
  'freezeAllowanceDays',
  'dailyReservationLimit',
  'cancellationAllowanceCount',
  'activeReservationLimit',
  'description',
  'active',
  'serviceIds',
  'onlineSellable',
  'memberSellable',
] as const

export function decideUpdateProduct(ctx: DecideContext, current: Product, next: Product): NewEvent[] {
  const changes = diffFields(current, next, PRODUCT_FIELDS)

  // `components` YUKARIDAKİ LİSTEDE DEĞİL, kasten: nesne dizisi, ve `diffFields` dizi elemanlarını
  // referansla kıyaslıyor — aynı demet her kayıtta "değişti" görünürdü. Burada yapısal olarak
  // kıyaslanıyor, böylece yalnızca demet içeriğini değiştiren bir kayıt ne sessizce yok sayılıyor
  // ne de her seferinde yalancı bir değişiklik bildiriyor.
  const demetOnce = JSON.stringify(current.components ?? null)
  const demetSonra = JSON.stringify(next.components ?? null)
  const tum =
    demetOnce === demetSonra
      ? changes
      : [...changes, { field: 'components', from: current.components ?? null, to: next.components ?? null }]

  if (tum.length === 0) return []
  return [
    {
      ...base(ctx, next.id),
      type: PRODUCT_UPDATED,
      payload: { changedFields: changedFieldNames(tum), changes: tum },
    },
  ]
}
