import { describe, expect, it } from 'vitest'

import { vatInGross, vatSummary } from './invoice-vat'

describe('invoice VAT — the VAT inside a VAT-included total', () => {
  it('4.000 ₺ at 20% carries 666,67 ₺ (the Paraşüt invoice 1106608612)', () => {
    expect(vatInGross(400_000, 20)).toBe(66_667)
  })
  it('sums per row, and a zero rate is zero VAT', () => {
    expect(vatSummary([400_000, 100_000], 20)).toEqual({ gross: 500_000, vat: 66_667 + 16_667 })
    expect(vatSummary([400_000], 0)).toEqual({ gross: 400_000, vat: 0 })
  })
  it('no rate set ⇒ no VAT figure, never a guessed 20%', () => {
    expect(vatSummary([400_000], null)).toEqual({ gross: 400_000, vat: null })
    expect(vatSummary([], 20)).toEqual({ gross: 0, vat: 0 })
  })
})
