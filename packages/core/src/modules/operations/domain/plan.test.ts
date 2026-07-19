import { describe, expect, it } from 'vitest'

import {
  instant,
  money,
  type ClassSessionId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type ServiceId,
  type StudioId,
} from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { Reservation } from '../../reservations'
import type { ClassSession } from '../../scheduling'
import { computeBulkPlan, computeClosurePlan } from './plan'

// D21 / D22 — the planners.
//
// These tests are the preview's promise: **nothing is skipped without a name.** A silent skip is
// a lie told by omission, and in an operation that refunds credits it is an expensive one.

const NOW = instant(1_700_000_000_000)
const DAY = 86_400_000

const session = (over: Partial<ClassSession> = {}): ClassSession =>
  ({
    id: 'cls_1' as ClassSessionId,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as never,
    serviceId: 'svc_1' as ServiceId,
    roomId: null,
    trainerId: null,
    templateId: null,
    category: 'pilates_group',
    assignedMemberId: null,
    startsAt: instant(NOW + DAY),
    endsAt: instant(NOW + DAY + 3_600_000),
    capacity: 8,
    status: 'scheduled',
    cancellation: null,
    policyRef: { serviceId: 'svc_1' as ServiceId, version: 1 },
    policySnapshot: {
      maxDaysInAdvance: 30,
      cancellationWindowHours: 6,
      cancellationWindowSource: 'service',
      lateCancellationConsumesCredit: true,
      noShowConsumesCredit: true,
      attendanceDefaultOutcome: 'attended',
      autoResolveAfterMinutes: 60,
      allowMemberSelfBooking: true,
    },
    bookedCount: 0,
    attendedCount: 0,
    serviceName: 'Reformer',
    roomName: null,
    trainerName: null,
    branchName: 'Merkez',
    ...over,
  }) as ClassSession

const reservation = (over: Partial<Reservation> = {}): Reservation =>
  ({
    id: 'res_1' as never,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as never,
    classSessionId: 'cls_1' as ClassSessionId,
    memberId: 'mem_1' as MemberId,
    entitlementId: 'ent_1' as EntitlementId,
    status: 'booked',
    creditEffect: 'held',
    sessionStartsAt: instant(NOW + DAY),
    sessionEndsAt: instant(NOW + DAY + 3_600_000),
    sessionCategory: 'pilates_group',
    memberSnapshot: { memberId: 'mem_1', displayName: 'E.', phoneLast4: '0000', membershipStatus: 'active' },
    bookedAt: NOW,
    bookedBy: { type: 'receptionist', id: 'usr_1' as never },
    resolvedAt: null,
    resolvedBy: null,
    attendanceSource: null,
    policyRef: { policyId: 'svc_1', version: 1 },
    ...over,
  }) as Reservation

const ent = (over: Partial<Entitlement> = {}, snap: Record<string, unknown> = {}): Entitlement =>
  ({
    id: 'ent_1' as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    productId: 'prd_1' as ProductId,
    productSnapshot: {
      productId: 'prd_1' as ProductId,
      name: 'Reformer 10',
      category: 'pilates_group',
      grant: { kind: 'credits', credits: 10, validForDays: 60 },
      listPrice: money(1),
      ...snap,
    },
    policyRef: { policyId: 'pol_1', version: 1 },
    status: 'active',
    validFrom: instant(NOW - 10 * DAY),
    validUntil: instant(NOW + 30 * DAY),
    credits: { granted: 10, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 },
    freeze: null,
    cancellationLedger: { used: 0, refunded: 0 },
    entryLedger: { consumed: 0, restored: 0 },
    priceAgreed: money(1),
    paidTotal: money(0),
    manualPayment: null,
    purchasedAt: instant(NOW - 10 * DAY),
    ...over,
  }) as Entitlement

const world = (
  sessions: ClassSession[],
  reservations: Record<string, Reservation[]>,
  entitlements: Entitlement[],
) => ({
  sessions,
  reservationsBySession: new Map(Object.entries(reservations)),
  entitlements,
  memberNames: new Map([['mem_1', 'Elif Ş.'], ['mem_2', 'Ayşe Y.']]),
})

const range = { closureFrom: instant(NOW), closureTo: instant(NOW + 7 * DAY) }

describe('computeClosurePlan (D21)', () => {
  it('plans the cancellation and counts the credits that come back', () => {
    const plan = computeClosurePlan(
      world([session()], { cls_1: [reservation(), reservation({ id: 'res_2' as never, memberId: 'mem_2' as MemberId })] }, []),
      { scope: { kind: 'studio' }, extensionDays: 0, ...range },
    )
    expect(plan.sessionsToCancel).toHaveLength(1)
    expect(plan.reservationsToRelease).toBe(2)
    expect(plan.creditsToRelease).toBe(2)
    expect(plan.membersAffected).toHaveLength(2)
  })

  it('a PERIOD booking held no credit, so none comes back', () => {
    const plan = computeClosurePlan(
      world([session()], { cls_1: [reservation({ creditEffect: 'none' })] }, []),
      { scope: { kind: 'studio' }, extensionDays: 0, ...range },
    )
    expect(plan.reservationsToRelease).toBe(1)
    expect(plan.creditsToRelease).toBe(0) // an unlimited membership loses nothing to refund
  })

  it('BLOCKS a session whose reservation is already resolved (OQ-6) — never silently corrects it', () => {
    const plan = computeClosurePlan(
      world([session()], { cls_1: [reservation({ status: 'attended', creditEffect: 'consumed' })] }, []),
      { scope: { kind: 'studio' }, extensionDays: 0, ...range },
    )
    expect(plan.sessionsToCancel).toHaveLength(0)
    expect(plan.blockedSessions).toHaveLength(1)
    expect(plan.blockedSessions[0]?.reason).toBe('already_resolved')
  })

  it('reports an already-cancelled session rather than pretending it did something', () => {
    const plan = computeClosurePlan(
      world([session({ status: 'cancelled' })], {}, []),
      { scope: { kind: 'studio' }, extensionDays: 0, ...range },
    )
    expect(plan.blockedSessions[0]?.reason).toBe('already_cancelled')
  })

  it('a CATEGORY scope cancels only that category’s classes', () => {
    const plan = computeClosurePlan(
      world(
        [session(), session({ id: 'cls_2' as ClassSessionId, category: 'fitness' })],
        {},
        [],
      ),
      { scope: { kind: 'category', categories: ['fitness'] }, extensionDays: 0, ...range },
    )
    expect(plan.sessionsToCancel.map((s) => s.sessionId)).toEqual(['cls_2'])
  })

  // ── the extension (D21.1–D21.4) ─────────────────────────────────────────────────────────
  it('extends only packages whose validity OVERLAPS the closure (D21.2)', () => {
    const overlapping = ent()
    const expiredBefore = ent({ id: 'ent_2' as EntitlementId, validUntil: instant(NOW - DAY) })
    const startsAfter = ent({
      id: 'ent_3' as EntitlementId,
      validFrom: instant(NOW + 30 * DAY),
      validUntil: instant(NOW + 60 * DAY),
    })
    const plan = computeClosurePlan(world([], {}, [overlapping, expiredBefore, startsAfter]), {
      scope: { kind: 'studio' },
      extensionDays: 5,
      ...range,
    })
    expect(plan.entitlementsToExtend.map((e) => e.entitlementId)).toEqual(['ent_1'])
    // …and the other two are NAMED, not dropped.
    expect(plan.skippedEntitlements.map((e) => e.reason)).toEqual(['not_overlapping', 'not_overlapping'])
  })

  it('never touches a FROZEN package, and says so (D21.4 — DEBT-009 is not redesigned by accident)', () => {
    const plan = computeClosurePlan(world([], {}, [ent({ status: 'frozen' })]), {
      scope: { kind: 'studio' },
      extensionDays: 5,
      ...range,
    })
    expect(plan.entitlementsToExtend).toHaveLength(0)
    expect(plan.skippedEntitlements[0]?.reason).toBe('frozen')
  })

  it('extends nothing when the owner chose 0 days — the length is HER decision (D21.3)', () => {
    const plan = computeClosurePlan(world([], {}, [ent()]), {
      scope: { kind: 'studio' },
      extensionDays: 0,
      ...range,
    })
    expect(plan.entitlementsToExtend).toHaveLength(0)
    expect(plan.skippedEntitlements).toHaveLength(0) // not "skipped" — simply not asked for
  })

  it('a package-scoped closure extends only that product’s packages', () => {
    const other = ent({ id: 'ent_2' as EntitlementId }, { productId: 'prd_2' as ProductId })
    const plan = computeClosurePlan(world([], {}, [ent(), other]), {
      scope: { kind: 'product', productIds: ['prd_1' as ProductId] },
      extensionDays: 3,
      ...range,
    })
    expect(plan.entitlementsToExtend.map((e) => e.entitlementId)).toEqual(['ent_1'])
    expect(plan.skippedEntitlements[0]?.reason).toBe('out_of_scope')
  })
})

describe('computeBulkPlan (D22)', () => {
  const names = new Map([['mem_1', 'Elif Ş.']])

  it('applies to every active entitlement in scope', () => {
    const plan = computeBulkPlan([ent()], names, { kind: 'studio' })
    expect(plan.toApply).toHaveLength(1)
    expect(plan.skipped).toHaveLength(0)
  })

  it('names every skip: frozen, expired, cancelled, out of scope', () => {
    const plan = computeBulkPlan(
      [
        ent(),
        ent({ id: 'e_frozen' as EntitlementId, status: 'frozen' }),
        ent({ id: 'e_expired' as EntitlementId, status: 'expired' }),
        ent({ id: 'e_cancelled' as EntitlementId, status: 'cancelled' }),
        ent({ id: 'e_fitness' as EntitlementId }, { category: 'fitness' }),
      ],
      names,
      { kind: 'category', categories: ['pilates_group'] },
    )
    expect(plan.toApply.map((e) => e.entitlementId)).toEqual(['ent_1'])
    expect(plan.skipped.map((s) => [s.entitlementId, s.reason])).toEqual([
      ['e_frozen', 'frozen'],
      ['e_expired', 'not_active'],
      ['e_cancelled', 'not_active'],
      ['e_fitness', 'out_of_scope'],
    ])
  })

  it('a members-scoped operation touches only those members', () => {
    const other = ent({ id: 'ent_2' as EntitlementId, memberId: 'mem_2' as MemberId })
    const plan = computeBulkPlan([ent(), other], names, {
      kind: 'members',
      memberIds: ['mem_2' as MemberId],
    })
    expect(plan.toApply.map((e) => e.entitlementId)).toEqual(['ent_2'])
    expect(plan.skipped[0]?.reason).toBe('out_of_scope')
  })
})
