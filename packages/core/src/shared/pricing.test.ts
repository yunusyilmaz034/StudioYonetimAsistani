import { describe, expect, it } from 'vitest'

import { cardSurchargeKurus, productPrices } from './pricing'

// `productPrices` is the ONE place that decides what a member pays, in cash and by card, for every
// surface: the desk sale form, the mobile app, the marketing site and the WhatsApp assistant. A
// mistake here is a mistake in money, so the two arrangements are pinned separately and the identity
// that binds them — cash + extra = card — is asserted in both.
describe('productPrices', () => {
  const cfg = { byCategory: { fitness: { percent: 10 } }, cardTransferSurchargeKurus: 5_000 }

  it('derives the card price from the category rule when there is no cash price', () => {
    const p = productPrices({ priceInKurus: 900_000, category: 'fitness' }, cfg)
    expect(p).toEqual({ cashKurus: 900_000, cardExtraKurus: 90_000, cardKurus: 990_000 })
  })

  it('falls back to the flat surcharge for a category with no rule of its own', () => {
    const p = productPrices({ priceInKurus: 500_000, category: 'pilates_group' }, cfg)
    expect(p).toEqual({ cashKurus: 500_000, cardExtraKurus: 5_000, cardKurus: 505_000 })
  })

  it('treats priceInKurus as the CARD price once the product carries its own cash price', () => {
    // The August 2026 campaign: 8.500 cash / 9.500 card. The category rule is ignored on purpose —
    // applying it on top would invent a third price nobody advertised.
    const p = productPrices({ priceInKurus: 950_000, cashPriceInKurus: 850_000, category: 'fitness' }, cfg)
    expect(p).toEqual({ cashKurus: 850_000, cardExtraKurus: 100_000, cardKurus: 950_000 })
  })

  it('reports one price as equal figures, so a screen can compare and stay silent', () => {
    const p = productPrices({ priceInKurus: 500_000, category: 'fitness' }, null)
    expect(p.cashKurus).toBe(p.cardKurus)
    expect(p.cardExtraKurus).toBe(0)
  })

  it('a cash price EQUAL to the card price is still one price, not a difference of zero to display', () => {
    const p = productPrices({ priceInKurus: 500_000, cashPriceInKurus: 500_000, category: 'fitness' }, cfg)
    expect(p).toEqual({ cashKurus: 500_000, cardExtraKurus: 0, cardKurus: 500_000 })
  })

  it('null and undefined cash prices both mean "no cash price"', () => {
    const withNull = productPrices({ priceInKurus: 500_000, cashPriceInKurus: null, category: 'fitness' }, cfg)
    expect(withNull).toEqual(productPrices({ priceInKurus: 500_000, category: 'fitness' }, cfg))
  })

  it('holds cash + extra = card in every arrangement', () => {
    const cases = [
      { priceInKurus: 900_000, category: 'fitness' },
      { priceInKurus: 950_000, cashPriceInKurus: 850_000, category: 'fitness' },
      { priceInKurus: 1_275_000, cashPriceInKurus: 1_275_000, category: 'private' },
      { priceInKurus: 1, category: 'private' },
    ]
    for (const c of cases) {
      const p = productPrices(c, cfg)
      expect(p.cashKurus + p.cardExtraKurus).toBe(p.cardKurus)
      expect(Number.isInteger(p.cardExtraKurus)).toBe(true)
    }
  })

  it('leaves cardSurchargeKurus untouched for callers that only want the rule', () => {
    expect(cardSurchargeKurus(900_000, 'fitness', cfg)).toBe(90_000)
  })
})
