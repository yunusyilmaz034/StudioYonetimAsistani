import { describe, expect, it } from 'vitest'

import { instant, type StudioId } from '../../../shared'
import type { Product } from './types'
import { decideUpdateProduct } from './decide'

// WHY THIS FILE EXISTS.
//
// `updateProduct` writes nothing when the decision produces no events — a sensible rule that turns
// vicious when the decision cannot SEE the field that changed. `cashPriceInKurus` was not in the
// watched list, so editing only a product's cash price produced no event, saved nothing, and
// returned ok. The form said "kaydedildi". The owner entered eight cash prices, some of them did
// not stick, and nothing anywhere said why.
//
// The cash/card gap decides what a sale is booked at, so a silently-ignored edit here shows up later
// as money missing from a sale — which is exactly how it was found.

const CTX = {
  studioId: 'retro' as StudioId,
  actor: { type: 'owner', id: 'usr_1' },
  now: instant(1_800_000_000_000),
  correlationId: 'cor_1',
  source: 'reception',
} as unknown as Parameters<typeof decideUpdateProduct>[0]

const urun = (over: Partial<Product> = {}): Product =>
  ({
    id: 'prd_1',
    studioId: 'retro',
    name: 'Fitness - 1 Aylık',
    category: 'fitness',
    serviceIds: ['svc_1'],
    type: 'period',
    durationDays: 30,
    creditCount: null,
    priceInKurus: 440_000,
    cashPriceInKurus: 400_000,
    freezeAllowanceDays: 14,
    dailyReservationLimit: null,
    cancellationAllowanceCount: null,
    activeReservationLimit: null,
    entryAllowance: null,
    components: null,
    description: '',
    active: true,
    onlineSellable: true,
    memberSellable: true,
    ...over,
  }) as unknown as Product

describe('decideUpdateProduct — the fields an edit is allowed to change', () => {
  it('notices a cash-price-only edit — the one that was silently dropped', () => {
    const events = decideUpdateProduct(CTX, urun(), urun({ cashPriceInKurus: 399_998 }))
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({ changedFields: ['cashPriceInKurus'] })
  })

  it('notices an entry-allowance-only edit', () => {
    const events = decideUpdateProduct(CTX, urun(), urun({ entryAllowance: 8 }))
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({ changedFields: ['entryAllowance'] })
  })

  it('notices a bundle whose CONTENTS changed', () => {
    const once = urun({ components: [{ category: 'fitness', creditCount: null, entryAllowance: 8, label: '8 giriş' }] as never })
    const sonra = urun({ components: [{ category: 'fitness', creditCount: null, entryAllowance: 6, label: '6 giriş' }] as never })
    const events = decideUpdateProduct(CTX, once, sonra)
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({ changedFields: ['components'] })
  })

  it('does NOT invent a change for an identical bundle', () => {
    // The reason `components` is compared structurally instead of joining the plain field list:
    // it is an array of objects, and a reference compare would report a change on every save.
    const yap = () => [{ category: 'fitness', creditCount: null, entryAllowance: 8, label: '8 giriş' }] as never
    // Ayrı ayrı kurulmuş ama İÇERİĞİ aynı iki dizi: referans kıyaslaması bunlara "değişti" derdi.
    const events = decideUpdateProduct(CTX, urun({ components: yap() }), urun({ components: yap() }))
    expect(events).toHaveLength(0)
  })

  it('an edit that changes nothing produces nothing', () => {
    expect(decideUpdateProduct(CTX, urun(), urun())).toHaveLength(0)
  })
})
