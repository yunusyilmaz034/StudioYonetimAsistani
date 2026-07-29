import { describe, expect, it } from 'vitest'

import type { Instant, ProductId } from '../../../shared'
import { DUPLICATE_SALE_WINDOW_MS, isSuspectedDuplicate, type RecentSale } from './duplicate'

const P = 'prd_reformer_8' as ProductId
const OTHER = 'prd_fitness_1m' as ProductId
const NOW = 1_785_000_000_000 as Instant
const at = (msAgo: number): Instant => (NOW - msAgo) as Instant
const sale = (productId: ProductId, msAgo: number): RecentSale => ({ productId, purchasedAt: at(msAgo) })

describe('isSuspectedDuplicate', () => {
  it('catches the second press — same member, same product, seconds apart', () => {
    expect(isSuspectedDuplicate([sale(P, 3_000)], P, NOW)).toBe(true)
  })

  it('lets the FIRST sale through — nothing to repeat yet', () => {
    expect(isSuspectedDuplicate([], P, NOW)).toBe(false)
  })

  it('does not block a different package bought in the same minute', () => {
    // Reception sells a member a reformer package and a fitness membership back to back. Both are
    // real; only a repeat of the SAME product is suspicious.
    expect(isSuspectedDuplicate([sale(OTHER, 5_000)], P, NOW)).toBe(false)
  })

  it('opens up once the window has passed — a genuine second sale is only delayed', () => {
    expect(isSuspectedDuplicate([sale(P, DUPLICATE_SALE_WINDOW_MS + 1)], P, NOW)).toBe(false)
  })

  it('treats the boundary as open: exactly one window old is no longer recent', () => {
    // `exactly 60s` is not `59.999s` — the boundary is stated, not left to a reader's guess.
    expect(isSuspectedDuplicate([sale(P, DUPLICATE_SALE_WINDOW_MS)], P, NOW)).toBe(false)
    expect(isSuspectedDuplicate([sale(P, DUPLICATE_SALE_WINDOW_MS - 1)], P, NOW)).toBe(true)
  })

  it('does not let a future-stamped sale open the gate', () => {
    // Clock skew between the desk and the server must not read as "long ago".
    expect(isSuspectedDuplicate([sale(P, -5_000)], P, NOW)).toBe(true)
  })

  it('ignores an old sale of the same product — a renewal a month later is not a duplicate', () => {
    expect(isSuspectedDuplicate([sale(P, 30 * 24 * 3_600_000)], P, NOW)).toBe(false)
  })

  it('finds the recent one among many', () => {
    const history = [sale(P, 90 * 24 * 3_600_000), sale(OTHER, 1_000), sale(P, 2_000)]
    expect(isSuspectedDuplicate(history, P, NOW)).toBe(true)
  })
})
