import { describe, expect, it } from 'vitest'

import { cardSurchargeKurus } from './pricing'

describe('cardSurchargeKurus', () => {
  // The studio's real config: Pilates & PT add 10 %, Fitness adds a flat 1000 TL, and any other
  // category falls back to the legacy flat default.
  const cfg = {
    cardTransferSurchargeKurus: 50000,
    byCategory: {
      pilates_group: { percent: 10 },
      fitness: { fixedKurus: 100000 },
      private: { percent: 10 },
    },
  } as const

  it('applies a percent rule, rounded to the nearest kuruş', () => {
    expect(cardSurchargeKurus(420000, 'pilates_group', cfg)).toBe(42000) // 4200 TL → +420 TL
    expect(cardSurchargeKurus(1200000, 'private', cfg)).toBe(120000) // PT 12000 TL → +1200 TL
  })

  it('applies a fixed rule verbatim, independent of the price', () => {
    expect(cardSurchargeKurus(800000, 'fitness', cfg)).toBe(100000) // 8000 TL → +1000 TL flat
    expect(cardSurchargeKurus(1300000, 'fitness', cfg)).toBe(100000) // 13000 TL → still +1000 TL
  })

  it('falls back to the flat default for a category with no rule', () => {
    expect(cardSurchargeKurus(100000, 'retail', cfg)).toBe(50000)
    expect(cardSurchargeKurus(100000, undefined, cfg)).toBe(50000)
  })

  it('returns 0 when nothing is configured', () => {
    expect(cardSurchargeKurus(100000, 'pilates_group', null)).toBe(0)
    expect(cardSurchargeKurus(100000, 'pilates_group', {})).toBe(0)
    expect(cardSurchargeKurus(100000, 'pilates_group', undefined)).toBe(0)
  })

  it('rounds a fractional percent to an integer number of kuruş', () => {
    expect(cardSurchargeKurus(12345, 'pilates_group', cfg)).toBe(1235) // 1234.5 → 1235
  })
})
