import type { Category } from '../../shared'
import type { ProductType } from './domain/types'

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
}

export type ProductUpdatedPayload = {
  readonly changedFields: readonly string[]
}
