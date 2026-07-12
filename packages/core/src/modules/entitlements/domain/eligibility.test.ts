import { describe, expect, it } from 'vitest'

import {
  instant,
  money,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type ServiceId,
  type StudioId,
} from '../../../shared'
import { coversService, isEligibleForService } from './eligibility'
import type { Entitlement, ProductSnapshot } from './types'

// D12 — the service-level right. The cases that matter are the boundary ones: what a package
// sold BEFORE D12 is worth, and what a package that names nothing is worth. They are opposites,
// and conflating them would either strip members of rights they paid for or hand out access
// nobody sold.
function snap(over: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    productId: 'prd_1' as ProductId,
    name: 'Pilates 8',
    category: 'pilates_group',
    grant: { kind: 'credits', credits: 8, validForDays: 30 },
    listPrice: money(420_000),
    ...over,
  }
}

const SVC = 'svc_1' as ServiceId
const OTHER = 'svc_2' as ServiceId

describe('coversService (D12 — service-level eligibility)', () => {
  it('covers a service that is named in the list', () => {
    expect(coversService(snap({ serviceIds: [SVC, OTHER] }), SVC)).toBe(true)
  })

  it('does NOT cover a service the package never named', () => {
    expect(coversService(snap({ serviceIds: [OTHER] }), SVC)).toBe(false)
  })

  it('a LEGACY snapshot (no service list) keeps its category-wide right', () => {
    // Sold before D12. Absence is not missing data — it is the record of what was sold, and it
    // is never backfilled from today's product definition (owner, 2026-07-12).
    expect(coversService(snap(), SVC)).toBe(true)
    expect(coversService(snap(), OTHER)).toBe(true)
  })

  it('an EMPTY list covers nothing — it is not "covers everything"', () => {
    expect(coversService(snap({ serviceIds: [] }), SVC)).toBe(false)
  })
})


// ── D13 — the PT member picker asks exactly this question (owner, 2026-07-12) ──────────
// "Which members could actually be reserved into this PT slot?" It is the MEMBER-dependent
// half of decideBooking — never a second, looser filter written for the UI.
const NOW = instant(1_700_000_000_000)
const DAY = 86_400_000
const PT_SVC = 'svc_pt' as ServiceId

function ent(over: Partial<Entitlement> = {}, snapOver: Partial<ProductSnapshot> = {}): Entitlement {
  return {
    id: 'ent_1' as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    productId: 'prd_1' as ProductId,
    productSnapshot: {
      productId: 'prd_1' as ProductId,
      name: 'PT 8',
      category: 'private',
      grant: { kind: 'credits', credits: 8, validForDays: 60 },
      listPrice: money(640_000),
      serviceIds: [PT_SVC],
      ...snapOver,
    },
    policyRef: { policyId: 'pol_1', version: 1 },
    status: 'active',
    validFrom: instant(NOW - DAY),
    validUntil: instant(NOW + 30 * DAY),
    credits: { granted: 8, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 },
    freeze: null,
    priceAgreed: money(640_000),
    paidTotal: money(0),
    manualPayment: null,
    purchasedAt: instant(NOW - DAY),
    ...over,
  }
}

const eligible = (e: Entitlement) => isEligibleForService(e, 'private', PT_SVC, instant(NOW + DAY))

describe('isEligibleForService (D13 — who may be reserved into this PT slot)', () => {
  it('1 — a member with a PT package covering this service IS eligible', () => {
    expect(eligible(ent())).toBe(true)
  })

  it('2 — a fitness / group-pilates package is NOT eligible for a PT service', () => {
    const fitness = ent({}, { category: 'fitness', serviceIds: ['svc_fitness' as ServiceId] })
    expect(eligible(fitness)).toBe(false)
    // …and neither is a PT-category package that does not cover THIS pt service (D12).
    const otherPt = ent({}, { serviceIds: ['svc_other_pt' as ServiceId] })
    expect(eligible(otherPt)).toBe(false)
  })

  it('3 — an EXPIRED or non-active entitlement is not eligible', () => {
    expect(eligible(ent({ validUntil: instant(NOW - DAY) }))).toBe(false) // expires before the class
    expect(eligible(ent({ status: 'expired' }))).toBe(false)
    expect(eligible(ent({ status: 'cancelled' }))).toBe(false)
    expect(eligible(ent({ status: 'frozen' }))).toBe(false)
  })

  it('4 — a member with NO credit left is not eligible', () => {
    const spent = ent({
      credits: { granted: 8, held: 0, consumed: 8, restored: 0, revoked: 0, expired: 0 },
    })
    expect(eligible(spent)).toBe(false)
  })

  it('5 — a LEGACY private package (no service list) IS eligible via the category fallback', () => {
    const base = ent()
    const legacySnap: ProductSnapshot = {
      productId: base.productSnapshot.productId,
      name: base.productSnapshot.name,
      category: base.productSnapshot.category,
      grant: base.productSnapshot.grant,
      listPrice: base.productSnapshot.listPrice,
      // no `serviceIds` at all — sold before D12
    }
    expect(eligible({ ...base, productSnapshot: legacySnap })).toBe(true)
  })

  it('an unlimited (period) PT package is eligible — it has no credit counter to exhaust', () => {
    const period = ent(
      { credits: null },
      { grant: { kind: 'period', durationDays: 90, access: 'unlimited' } },
    )
    expect(eligible(period)).toBe(true)
  })

  it('the predicate is INDEPENDENT of the session — it never asks "is it full?" or "has it started?"', () => {
    // That is why the picker cannot be emptied by session-shaped facts the owner did not ask
    // about. Capacity and start-time are enforced at booking (decideBooking), not here.
    expect(isEligibleForService(ent(), 'private', PT_SVC, instant(NOW + 365 * DAY))).toBe(false) // only expiry matters
    expect(isEligibleForService(ent(), 'private', PT_SVC, instant(NOW + DAY))).toBe(true)
  })
})
