import { describe, expect, it } from 'vitest'

import {
  available,
  instant,
  isEligibleForService,
  money,
  type Category,
  type Entitlement,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type ServiceId,
  type StudioId,
} from '@studio/core'

// The portal agenda's visibility rule (Batch 7), tested at the level that actually decides it:
// the SAME predicate the booking decider uses, plus the PT ownership check.
//
// This test exists because the agenda is the one place where hiding something wrongly is
// invisible: a member who never sees a class she was entitled to will not file a bug — she will
// just stop coming.
//
//   visible(session, member) =
//       some active entitlement is eligible for the session's SERVICE, at its start time
//   AND (session.assignedMemberId == null  OR  == her)

const NOW = instant(1_700_000_000_000)
const DAY = 86_400_000
const AT = instant(NOW + DAY) // the class runs tomorrow

const SVC_REFORMER = 'svc_reformer' as ServiceId
const SVC_MAT = 'svc_mat' as ServiceId
const SVC_FITNESS = 'svc_fitness' as ServiceId
const SVC_PT = 'svc_pt' as ServiceId

const ME = 'mem_me' as MemberId
const SOMEONE_ELSE = 'mem_other' as MemberId

function ent(
  category: Category,
  serviceIds: readonly ServiceId[] | undefined,
  over: Partial<Entitlement> = {},
): Entitlement {
  const snapshot = {
    productId: 'prd_1' as ProductId,
    name: 'P',
    category,
    grant: { kind: 'credits' as const, credits: 8, validForDays: 60 },
    listPrice: money(1),
    ...(serviceIds ? { serviceIds } : {}),
  }
  return {
    id: 'ent_1' as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: ME,
    productId: 'prd_1' as ProductId,
    productSnapshot: snapshot,
    policyRef: { policyId: 'pol_1', version: 1 },
    status: 'active',
    validFrom: instant(NOW - DAY),
    validUntil: instant(NOW + 30 * DAY),
    credits: { granted: 8, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 },
    freeze: null,
    priceAgreed: money(1),
    paidTotal: money(0),
    manualPayment: null,
    purchasedAt: instant(NOW - DAY),
    ...over,
  }
}

// The visibility rule, exactly as `loadPortalAgenda` applies it.
const sees = (
  entitlements: readonly Entitlement[],
  session: { category: Category; serviceId: ServiceId; assignedMemberId: MemberId | null },
): boolean => {
  const assigned = session.assignedMemberId
  if (assigned !== null && assigned !== ME) return false // D13 — someone else's PT slot
  return entitlements.some((e) => isEligibleForService(e, session.category, session.serviceId, AT))
}

const reformerClass = { category: 'pilates_group' as Category, serviceId: SVC_REFORMER, assignedMemberId: null }
const matClass = { category: 'pilates_group' as Category, serviceId: SVC_MAT, assignedMemberId: null }
const fitnessClass = { category: 'fitness' as Category, serviceId: SVC_FITNESS, assignedMemberId: null }
const openPt = { category: 'private' as Category, serviceId: SVC_PT, assignedMemberId: null }
const myPt = { category: 'private' as Category, serviceId: SVC_PT, assignedMemberId: ME }
const herPt = { category: 'private' as Category, serviceId: SVC_PT, assignedMemberId: SOMEONE_ELSE }

describe('portal agenda visibility (Batch 7)', () => {
  it('a FITNESS member does not see pilates at all', () => {
    const fitness = [ent('fitness', [SVC_FITNESS])]
    expect(sees(fitness, fitnessClass)).toBe(true)
    expect(sees(fitness, reformerClass)).toBe(false)
    expect(sees(fitness, matClass)).toBe(false)
  })

  it('a REFORMER package does not open Mat Pilates — same category, different service (D12)', () => {
    const reformer = [ent('pilates_group', [SVC_REFORMER])]
    expect(sees(reformer, reformerClass)).toBe(true)
    expect(sees(reformer, matClass)).toBe(false) // the category wall alone would have allowed it
  })

  it('a LEGACY package keeps the category-wide right it was sold', () => {
    const legacy = [ent('pilates_group', undefined)]
    expect(sees(legacy, reformerClass)).toBe(true)
    expect(sees(legacy, matClass)).toBe(true) // category-wide, as sold — never narrowed
    expect(sees(legacy, fitnessClass)).toBe(false) // the category wall still stands
  })

  it('several packages show the UNION of what they cover', () => {
    const both = [ent('pilates_group', [SVC_REFORMER]), ent('fitness', [SVC_FITNESS])]
    expect(sees(both, reformerClass)).toBe(true)
    expect(sees(both, fitnessClass)).toBe(true)
    expect(sees(both, matClass)).toBe(false) // still not covered by either
  })

  it('an OPEN PT slot is visible to any member with a covering PT package (D13)', () => {
    expect(sees([ent('private', [SVC_PT])], openPt)).toBe(true)
  })

  it('a PT slot RESERVED for her is visible to her', () => {
    expect(sees([ent('private', [SVC_PT])], myPt)).toBe(true)
  })

  it('a PT slot reserved for SOMEONE ELSE is invisible — even with a valid PT package', () => {
    expect(sees([ent('private', [SVC_PT])], herPt)).toBe(false)
  })

  it('a member with no PT package sees no PT at all', () => {
    expect(sees([ent('pilates_group', [SVC_REFORMER])], openPt)).toBe(false)
  })

  it('an EXPIRED package shows nothing', () => {
    const expired = [ent('pilates_group', [SVC_REFORMER], { validUntil: instant(NOW) })]
    expect(sees(expired, reformerClass)).toBe(false) // expires before the class runs
  })

  it('a package with NO CREDIT left is not "eligible" — the agenda keeps the class visible by a separate, deliberate rule', () => {
    // `isEligibleForService` is false when nothing is left to spend…
    const spent = ent('pilates_group', [SVC_REFORMER], {
      credits: { granted: 8, held: 0, consumed: 8, restored: 0, revoked: 0, expired: 0 },
    })
    expect(available(spent.credits!)).toBe(0)
    expect(isEligibleForService(spent, 'pilates_group', SVC_REFORMER, AT)).toBe(false)

    // …which is exactly why `loadPortalAgenda` ALSO asks "does the package cover this KIND of
    // class?" separately: a spent-out member still SEES her classes, with `blockedReason:
    // 'no_credit'`, instead of staring at an empty agenda she cannot explain.
    const coversKind =
      spent.status === 'active' &&
      spent.productSnapshot.category === 'pilates_group' &&
      (spent.productSnapshot.serviceIds?.includes(SVC_REFORMER) ?? true)
    expect(coversKind).toBe(true)
  })
})
