import { describe, expect, it } from 'vitest'

import type { ProductId } from '../../../shared'
import { foldLabel } from './headers'
import { foldAliases, suggestProducts, unknownLabels, type ProductShape } from './product-alias'

const p = (id: string, name: string, durationDays: number, creditCount: number | null): ProductShape => ({
  productId: id as ProductId,
  name,
  durationDays,
  creditCount,
})

// The studio's real catalogue, which is what the labels have to be judged against.
const CATALOGUE = [
  p('prd_f1', 'Fitness - 1 Aylık', 30, null),
  p('prd_f3', 'Fitness - 3 Aylık', 90, null),
  p('prd_f6', 'Fitness - 6 Aylık', 180, null),
  p('prd_r8', 'Reformer Pilates - 8 Ders', 30, 8),
  p('prd_r16', 'Reformer Pilates - 16 Ders', 60, 16),
]

describe('suggestProducts', () => {
  it('reads the month out of the labels the real export actually uses', () => {
    // `6 AY`, `3 AY`, `1 AY`, `2 AY`, `3AY` — the old system stored a duration, not a product.
    expect(suggestProducts('6 AY', CATALOGUE).map((s) => s.productId)).toEqual(['prd_f6'])
    expect(suggestProducts('3AY', CATALOGUE).map((s) => s.productId)).toEqual(['prd_f3'])
    expect(suggestProducts('1 ay', CATALOGUE).map((s) => s.productId)).toContain('prd_f1')
  })

  it('offers EVERY product of that length, and never picks a category', () => {
    // A one-month label matches the fitness membership AND the eight-class pilates package, because
    // both run thirty days. The label does not say which, and neither may we: a wrong product is a
    // right in the wrong CATEGORY, and the category wall is what the UI cannot repair afterwards.
    const ids = suggestProducts('1 AY', CATALOGUE).map((s) => s.productId)
    expect(ids).toEqual(expect.arrayContaining(['prd_f1', 'prd_r8']))
    expect(ids).toHaveLength(2)
  })

  it('offers a 60-day product for `2 AY` — there is no fitness one, but there is a pilates one', () => {
    // The catalogue has no two-month fitness membership, and the label does not say "fitness". What
    // it does have is a 60-day, 16-class pilates package, so that is offered and the operator says
    // no. Silently offering nothing would hide a real option; silently picking one would cross the
    // category wall.
    expect(suggestProducts('2 AY', CATALOGUE).map((s) => s.productId)).toEqual(['prd_r16'])
  })

  it('gives nothing when no product is anywhere near that length', () => {
    expect(suggestProducts('9 AY', CATALOGUE)).toEqual([])
  })

  it('reads a class count when the label counts classes', () => {
    expect(suggestProducts('8 DERS', CATALOGUE).map((s) => s.productId)).toEqual(['prd_r8'])
    expect(suggestProducts('16 seans', CATALOGUE).map((s) => s.productId)).toEqual(['prd_r16'])
  })

  it('allows a week of slack, because 3 aylık is 90 days in one catalogue and 92 in another', () => {
    const odd = [p('prd_x', 'Üç Aylık', 92, null)]
    expect(suggestProducts('3 AY', odd)).toHaveLength(1)
    // But not a month of slack: 4 AY is not 3 AY.
    expect(suggestProducts('4 AY', odd)).toEqual([])
  })

  it('says nothing about a label with no number in it', () => {
    expect(suggestProducts('GRUP PAKET', CATALOGUE)).toEqual([])
  })
})

describe('unknownLabels', () => {
  const products = CATALOGUE.map((c) => ({ productId: c.productId, name: c.name }))

  it('counts the distinct labels the catalogue does not know, busiest first', () => {
    const labels = ['6 AY', '3 AY', '6 AY', '3 AY', '3 AY', 'Fitness - 1 Aylık']
    expect(unknownLabels(labels, products, {})).toEqual([
      { label: '3 AY', rows: 3 },
      { label: '6 AY', rows: 2 },
    ])
    // A label on sixty rows deserves more care than one on a single row she can also just skip.
  })

  it('does not report a label the catalogue already matches, whatever its punctuation', () => {
    expect(unknownLabels(['fitness 1 aylık', 'FITNESS - 1 AYLIK'], products, {})).toEqual([])
  })

  it('drops a label once the operator has mapped it', () => {
    expect(unknownLabels(['6 AY'], products, { [foldLabel('6 AY')]: 'prd_f6' })).toEqual([])
  })

  it('ignores empty cells', () => {
    expect(unknownLabels(['', '   ', '6 AY'], products, {})).toEqual([{ label: '6 AY', rows: 1 }])
  })
})

describe('foldAliases', () => {
  it('folds keys so lookup survives case, spacing and Turkish letters', () => {
    const folded = foldAliases({ '6 AY': 'prd_f6', '3AY': 'prd_f3' })
    expect(Object.keys(folded).sort()).toEqual(['3ay', '6ay'])
    expect(folded['6ay']).toBe('prd_f6')
  })

  it('KEEPS DIGITS — the whole reason this folding exists', () => {
    // `foldName`, built for people, strips everything that is not a letter. Under it,
    // "Reformer Pilates - 8 Ders" and "…16 Ders" become the same key, and so do "6 AY" and "3 AY".
    // The lookup would hold whichever came last and hand out the wrong package.
    expect(foldLabel('Reformer Pilates - 8 Ders')).not.toBe(foldLabel('Reformer Pilates - 16 Ders'))
    expect(foldLabel('6 AY')).not.toBe(foldLabel('3 AY'))
    expect(foldLabel('3AY')).toBe(foldLabel('3 ay'))
  })

  it('drops an entry the operator left unanswered', () => {
    expect(foldAliases({ '2 AY': '' })).toEqual({})
  })
})

// ── The regression that stalled the wizard (2026-07-30) ─────────────────────────────────────
//
// The server passed the operator's answers to `unknownLabels` with RAW keys ("3 AY") while the
// function looks them up FOLDED ("3ay"). Every answered label therefore read as unanswered, the
// wizard bounced back to the alias step, and the screen simply stopped moving — the spinner
// cleared, nothing advanced, and nothing on screen said why.
describe('answered labels disappear — only when the keys are folded', () => {
  const products = [{ productId: 'prd_f3' as ProductId, name: 'Fitness - 3 Aylık' }]

  it('clears once the alias table is folded, which is what the caller must pass', () => {
    expect(unknownLabels(['3 AY', '3 AY'], products, foldAliases({ '3 AY': 'prd_f3' }))).toEqual([])
  })

  it('does NOT clear when raw keys are passed — the exact stall, stated', () => {
    expect(unknownLabels(['3 AY'], products, { '3 AY': 'prd_f3' })).toEqual([{ label: '3 AY', rows: 1 }])
  })

  it('one answer covers every spelling of the same label', () => {
    // "3 AY" and "3AY" are two rows in the file and one decision for the operator.
    const folded = foldAliases({ '3 AY': 'prd_f3' })
    expect(unknownLabels(['3 AY', '3AY', '3 ay'], products, folded)).toEqual([])
  })
})
