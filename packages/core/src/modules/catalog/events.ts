import type { FieldChange } from '../../shared'
import type { Category } from '../../shared'
import type { ProductComponent, ProductType } from './domain/types'

// Catalogue events (Doc 4). No PII. The catalogue is data (AD-41); its history exists
// as these events. Two event types only — `product.updated` is generic (carries the
// changed field names, like service.updated), and deactivation is just an `active`
// field change, so no separate deactivate/reactivate event is needed.

export const PRODUCT_CREATED = 'product.created'
export const PRODUCT_UPDATED = 'product.updated'

export type ProductCreatedPayload = {
  readonly name: string
  readonly category: Category
  readonly type: ProductType
  readonly durationDays: number
  readonly creditCount: number | null
  readonly priceInKurus: number
  // Hibrit paket (v1.30) — additive. Present ONLY on a bundle product; absent on a normal product and
  // on every product created before bundles existed (a bundle-less past is not invented, I-30).
  readonly components?: readonly ProductComponent[]
}

export type ProductUpdatedPayload = {
  readonly changedFields: readonly string[]
  // OQ-2 — additive. Absent on events written before 2026-07-13; the Audit Log shows `—` for
  // those rather than inventing a past that was never recorded (I-30).
  readonly changes?: readonly FieldChange[]
}
