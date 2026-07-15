import { describe, expect, it } from 'vitest'

import { decideCreateProduct, decideUpdateProduct } from '../../src/modules/catalog/domain/decide'
import type { DecideContext } from '../../src/modules/catalog/domain/decide'
import type { Product } from '../../src/modules/catalog/domain/types'
import {
  instant,
  type CorrelationId,
  type ProductId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import productCreated from './product.created.v1.json'
import productUpdated from './product.updated.v1.json'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const product: Product = {
  id: 'prd_1' as ProductId,
  studioId: 'std_1' as StudioId,
  name: 'Reformer 8 Ders',
  category: 'pilates_group',
  serviceIds: [],
  type: 'credit',
  durationDays: 60,
  creditCount: 8,
  priceInKurus: 800000,
  freezeAllowanceDays: 14,
  dailyReservationLimit: null,
  cancellationAllowanceCount: null,
  activeReservationLimit: null,
  description: '',
  active: true,
}

describe('catalog event payloads match golden fixtures (AD-33)', () => {
  it('product.created', () => {
    expect(decideCreateProduct(ctx, product)[0]?.payload).toEqual(productCreated)
  })
  it('product.updated', () => {
    const events = decideUpdateProduct(ctx, product, { ...product, priceInKurus: 900000, active: false })
    expect(events[0]?.payload).toEqual(productUpdated)
  })
})
