import { describe, expect, it } from 'vitest'

import { instant, type Category, type EntitlementId, type MemberId, type ProductId, type StudioId } from '../../../shared'
import { blockedByFrozen, nextBundleStart, nextPackageStart } from './renewal'
import type { Entitlement } from './types'

// WHEN A RENEWAL STARTS. The rule exists because of one number: a member with twelve days left who
// buys a thirty-day package must get thirty days, not eighteen.

const NOW = instant(1_000_000_000_000)
const D = 86_400_000

const ent = (over: {
  id: string
  category?: Category
  validUntil: number
  credits?: number | null
  status?: Entitlement['status']
  frozen?: boolean
}): Entitlement =>
  ({
    id: over.id as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    productId: 'prd_1' as ProductId,
    productSnapshot: { category: over.category ?? 'pilates_group' },
    policyRef: { policyId: 'pol_1', version: 1 },
    status: over.status ?? 'active',
    validFrom: instant(NOW - 30 * D),
    validUntil: instant(over.validUntil),
    credits:
      over.credits === null
        ? null
        : { granted: 8, held: 0, consumed: 8 - (over.credits ?? 0), restored: 0, revoked: 0, expired: 0 },
    freeze: over.frozen ? { entitledDays: 7, usedDays: 0, periods: [], activeFrom: '2026-07-20' } : null,
  }) as unknown as Entitlement

describe('nextPackageStart', () => {
  it('starts today when she holds nothing', () => {
    expect(nextPackageStart([], 'pilates_group', NOW)).toBe(NOW)
  })

  // The whole point: she paid for thirty days and must get thirty days.
  it('queues behind a running package that still has credits', () => {
    const ends = NOW + 12 * D
    expect(nextPackageStart([ent({ id: 'e1', validUntil: ends, credits: 3 })], 'pilates_group', NOW)).toBe(ends)
  })

  // "Still valid" and "still any use" are different questions, and only the second should make a
  // renewal wait. Five members hold a package like this today.
  it('starts TODAY when the running package has no credits left', () => {
    const ends = NOW + 10 * D
    expect(nextPackageStart([ent({ id: 'e1', validUntil: ends, credits: 0 })], 'pilates_group', NOW)).toBe(NOW)
  })

  // The category wall means neither can pay for the other's class, so they run in parallel by design.
  it('ignores a package of a DIFFERENT category', () => {
    const fitness = ent({ id: 'e1', category: 'fitness', validUntil: NOW + 60 * D, credits: null })
    expect(nextPackageStart([fitness], 'pilates_group', NOW)).toBe(NOW)
  })

  it('waits behind an unlimited package until it expires', () => {
    const ends = NOW + 45 * D
    expect(nextPackageStart([ent({ id: 'e1', validUntil: ends, credits: null })], 'pilates_group', NOW)).toBe(ends)
  })

  // One member holds two same-category packages today. Clearing only the first would overlap the
  // second — the exact bug this rule exists to prevent, one layer down.
  it('clears the LAST of two overlapping packages, not the first', () => {
    const list = [
      ent({ id: 'e1', validUntil: NOW + 10 * D, credits: 2 }),
      ent({ id: 'e2', validUntil: NOW + 25 * D, credits: 4 }),
    ]
    expect(nextPackageStart(list, 'pilates_group', NOW)).toBe(NOW + 25 * D)
  })

  it('ignores expired and non-active packages', () => {
    const list = [
      ent({ id: 'e1', validUntil: NOW - D, credits: 5 }),
      ent({ id: 'e2', validUntil: NOW + 20 * D, credits: 5, status: 'cancelled' }),
    ]
    expect(nextPackageStart(list, 'pilates_group', NOW)).toBe(NOW)
  })

  // A renewal cannot begin in the past, whatever the data says.
  it('never returns an instant before now', () => {
    const list = [ent({ id: 'e1', validUntil: NOW - 5 * D, credits: 5 })]
    expect(nextPackageStart(list, 'pilates_group', NOW)).toBe(NOW)
  })
})

describe('blockedByFrozen', () => {
  // While frozen, `validUntil` has NOT been extended yet — the extension lands at unfreeze. Any queue
  // date computed now is one we already know is wrong, so the purchase is refused instead.
  it('is true while a same-category package is frozen', () => {
    expect(blockedByFrozen([ent({ id: 'e1', validUntil: NOW + 20 * D, credits: 3, frozen: true })], 'pilates_group', NOW)).toBe(true)
  })

  it('is false for a package that merely BUYS freeze days but is not frozen', () => {
    const withAllowance = ent({ id: 'e1', validUntil: NOW + 20 * D, credits: 3 })
    const notFrozen = { ...withAllowance, freeze: { entitledDays: 7, usedDays: 0, periods: [], activeFrom: null } } as Entitlement
    expect(blockedByFrozen([notFrozen], 'pilates_group', NOW)).toBe(false)
  })

  it('is false when the frozen package is a different category', () => {
    expect(blockedByFrozen([ent({ id: 'e1', category: 'fitness', validUntil: NOW + 20 * D, frozen: true })], 'pilates_group', NOW)).toBe(false)
  })
})

// ── Hybrids (2026-07-27) ─────────────────────────────────────────────────────────────────────
// A bundle grants one entitlement per component but they share ONE window. Answering the queue for
// the product's "face" category alone is how a hybrid's fitness half landed on top of a fitness
// membership the member had already paid for.
describe('nextBundleStart', () => {
  it('starts today when she holds nothing in any of its categories', () => {
    const r = nextBundleStart([], ['pilates_group', 'fitness'], NOW)
    expect(r.ok && r.startsAt).toBe(NOW)
  })

  it('queues behind the date BOTH categories agree on', () => {
    const ends = NOW + 12 * D
    const list = [
      ent({ id: 'p' as EntitlementId, validUntil: ends, credits: 3 }),
      ent({ id: 'f' as EntitlementId, category: 'fitness', validUntil: ends, credits: null }),
    ]
    const r = nextBundleStart(list, ['pilates_group', 'fitness'], NOW)
    expect(r.ok && r.startsAt).toBe(ends)
  })

  // The case that was silently wrong: pilates free today, fitness running to October. Starting today
  // bills her twice for fitness; starting in October denies her the pilates she is free to use. An
  // unattended checkout must not pick either — it says so and reception sells it with real dates.
  it('REFUSES when the categories queue to different dates', () => {
    const list = [ent({ id: 'f' as EntitlementId, category: 'fitness', validUntil: NOW + 60 * D, credits: null })]
    const r = nextBundleStart(list, ['pilates_group', 'fitness'], NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('categories_disagree')
      expect(r.perCategory.map((c) => c.startsAt)).toEqual([NOW, NOW + 60 * D])
    }
  })

  // A plain product routes through the same function; one category can never disagree with itself.
  it('behaves exactly like nextPackageStart for a single category', () => {
    const list = [ent({ id: 'p' as EntitlementId, validUntil: NOW + 9 * D, credits: 2 })]
    const r = nextBundleStart(list, ['pilates_group'], NOW)
    expect(r.ok && r.startsAt).toBe(nextPackageStart(list, 'pilates_group', NOW))
  })
})
