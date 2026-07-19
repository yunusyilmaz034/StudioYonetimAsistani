import { describe, expect, it } from 'vitest'

import {
  instant,
  type CorrelationId,
  type ProductId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import { decideCreateProduct, decideUpdateProduct } from './decide'
import type { DecideContext } from './decide'
import type { Product } from './types'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const product = (over: Partial<Product> = {}): Product => ({
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
  entryAllowance: null,
  description: '',
  active: true,
  ...over,
})

describe('decideCreateProduct', () => {
  it('emits product.created with the grant + price', () => {
    const events = decideCreateProduct(ctx, product())
    expect(events[0]?.type).toBe('product.created')
    expect(events[0]?.payload).toMatchObject({ type: 'credit', creditCount: 8, priceInKurus: 800000 })
  })
})

describe('decideUpdateProduct', () => {
  // OQ-2 (owner, 2026-07-13) — the edit records WHICH fields changed and, additively, what they
  // changed FROM and TO. This is the Audit Log's "eski değer → yeni değer", and it is why a price
  // edit can be explained six months later.
  it('records the changed fields with their before and after values', () => {
    const events = decideUpdateProduct(ctx, product(), product({ priceInKurus: 900000, active: false }))
    expect(events[0]?.payload).toEqual({
      changedFields: ['priceInKurus', 'active'],
      changes: [
        { field: 'priceInKurus', from: 800000, to: 900000 },
        { field: 'active', from: true, to: false },
      ],
    })
  })
  it('is a no-op when nothing changed', () => {
    expect(decideUpdateProduct(ctx, product(), product())).toHaveLength(0)
  })
  it('detects a serviceIds change', () => {
    const events = decideUpdateProduct(ctx, product(), product({ serviceIds: ['svc_9' as never] }))
    expect(events[0]?.payload).toEqual({
      changedFields: ['serviceIds'],
      changes: [{ field: 'serviceIds', from: [], to: ['svc_9'] }],
    })
  })
})
