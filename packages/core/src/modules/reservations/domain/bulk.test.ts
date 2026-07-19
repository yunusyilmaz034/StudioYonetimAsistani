import { describe, expect, it } from 'vitest'

import {
  instant,
  money,
  newCorrelationId,
  type EntitlementId,
  type LocalDate,
  type MemberId,
  type ProductId,
  type ReservationId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import type { ClassSession, SessionPolicySnapshot } from '../../scheduling'
import { planBulkCancel, planBulkMove, type BulkMoveCandidate } from './bulk'
import type { DecideContext } from './decide'
import type { Reservation } from './types'

// The bulk plan is what reception READS before she presses the button, so its two dangerous lies are
// the two things tested here:
//
//   1. "everyone gets their credit back"  — when half of them are inside the cancellation window.
//   2. "all eight will move"              — into a room with three free seats.
//
// A preview that promises what the act cannot deliver is worse than no preview: she has already told
// five women they are in the Wednesday class.

// AG-1 — these cases are about seats and credits, not opening hours; the studio has none configured.
const OPEN_ALWAYS = { hours: null, utcOffsetMinutes: 180, specialWorkingDates: new Set<LocalDate>() }

const NOW = instant(1_000_000_000_000)
const H = 3_600_000

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: NOW,
  correlationId: newCorrelationId(),
  source: 'reception',
}

const pol = (p: Partial<SessionPolicySnapshot> = {}): SessionPolicySnapshot => ({
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  cancellationWindowSource: 'service' as const,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: false,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
  allowMemberSelfBooking: false,
  ...p,
})

const session = (over: Partial<ClassSession> = {}): ClassSession => ({
  id: 'cls_1' as unknown as ClassSession['id'],
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as unknown as ClassSession['branchId'],
  serviceId: 'svc_1' as unknown as ClassSession['serviceId'],
  roomId: null,
  trainerId: null,
  templateId: null,
  assignedMemberId: null,
  category: 'pilates_group',
  startsAt: instant(NOW + 24 * H), // tomorrow — comfortably outside the 6h window
  endsAt: instant(NOW + 25 * H),
  capacity: 8,
  status: 'scheduled',
  cancellation: null,
  policyRef: { serviceId: 'svc_1' as unknown as ClassSession['serviceId'], version: 2 },
  policySnapshot: pol(),
  bookedCount: 0,
  attendedCount: 0,
  serviceName: 'Reformer',
  roomName: null,
  trainerName: null,
  branchName: 'Merkez',
  ...over,
})

const snap = (n: number): MemberSnapshot => ({
  memberId: `mem_${n}` as MemberId,
  displayName: `Üye ${n}`,
  phoneLast4: '4567',
  membershipStatus: 'active',
})

const reservation = (n: number, over: Partial<Reservation> = {}): Reservation => ({
  id: `res_${n}` as ReservationId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as unknown as Reservation['branchId'],
  classSessionId: 'cls_1' as unknown as Reservation['classSessionId'],
  memberId: `mem_${n}` as MemberId,
  entitlementId: `ent_${n}` as EntitlementId,
  status: 'booked',
  creditEffect: 'held',
  sessionStartsAt: instant(NOW + 24 * H),
  sessionEndsAt: instant(NOW + 25 * H),
  sessionCategory: 'pilates_group',
  memberSnapshot: snap(n),
  bookedAt: instant(NOW - 3 * H),
  bookedBy: ctx.actor,
  resolvedAt: null,
  resolvedBy: null,
  attendanceSource: null,
  policyRef: { policyId: 'svc_1', version: 2 },
  ...over,
})

const ent = (n: number): Entitlement => ({
  id: `ent_${n}` as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: `mem_${n}` as MemberId,
  productId: 'prd_1' as ProductId,
  productSnapshot: {
    productId: 'prd_1' as ProductId,
    name: 'Pilates 8',
    category: 'pilates_group',
    grant: { kind: 'credits', credits: 8, validForDays: 30 },
    listPrice: money(420_000),
  },
  policyRef: { policyId: 'pol_1', version: 3 },
  status: 'active',
  validFrom: instant(NOW - 30 * H),
  validUntil: instant(NOW + 30 * 24 * H),
  credits: { granted: 8, held: 1, consumed: 0, restored: 0, revoked: 0, expired: 0 },
  freeze: null,
  cancellationLedger: { used: 0, refunded: 0 },
    entryLedger: { consumed: 0, restored: 0 },
  priceAgreed: money(294_000),
  paidTotal: money(0),
  manualPayment: null,
  purchasedAt: instant(NOW - 30 * H),
})

describe('toplu iptal — planı', () => {
  it('says the credit comes back when the class is still far away', () => {
    const rows = planBulkCancel(ctx, session(), [reservation(1), reservation(2)])
    expect(rows.map((r) => r.effect)).toEqual(['released', 'released'])
    expect(rows.every((r) => r.refusal === null)).toBe(true)
  })

  it('WARNS that a late cancel BURNS the credit — the class starts in two hours', () => {
    // Inside the 6h cancellation window. Reception must see this before she presses the button, not
    // after eight members have lost a class each.
    const soon = session({ startsAt: instant(NOW + 2 * H), endsAt: instant(NOW + 3 * H) })
    const rows = planBulkCancel(ctx, soon, [reservation(1), reservation(2)])
    expect(rows.map((r) => r.effect)).toEqual(['consumed', 'consumed'])
  })

  it('a reservation that is no longer open is refused, and named', () => {
    const rows = planBulkCancel(ctx, session(), [reservation(1, { status: 'attended' })])
    expect(rows[0]!.refusal).toBe('reservation_not_open')
    expect(rows[0]!.memberName).toBe('Üye 1')
  })
})

describe('toplu taşıma — planı', () => {
  const from = session()
  const target = (over: Partial<ClassSession> = {}) =>
    session({
      id: 'cls_2' as unknown as ClassSession['id'],
      startsAt: instant(NOW + 48 * H),
      endsAt: instant(NOW + 49 * H),
      ...over,
    })

  const candidates = (n: number, alreadyBooked = false): BulkMoveCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      reservation: reservation(i + 1),
      entitlement: ent(i + 1),
      alreadyBookedTarget: alreadyBooked,
    }))

  it('fills the room as it walks: three free seats, five members, two are refused', () => {
    // The bug this test exists to prevent: deciding every row against the target's ORIGINAL
    // bookedCount would pass all five, and the apply would then refuse two — after three had already
    // moved and reception had already told all five they were in.
    const rows = planBulkMove(ctx, from, target({ capacity: 8, bookedCount: 5 }), candidates(5), null, OPEN_ALWAYS)

    expect(rows.filter((r) => r.refusal === null)).toHaveLength(3)
    const refused = rows.filter((r) => r.refusal !== null)
    expect(refused).toHaveLength(2)
    expect(refused[0]!.refusal).toBe('class_full')
    // And it names them, in the order they were shown. She can tell those two women herself.
    expect(refused.map((r) => r.memberName)).toEqual(['Üye 4', 'Üye 5'])
  })

  it('refuses a member who is already in the target class', () => {
    const rows = planBulkMove(ctx, from, target(), candidates(1, true), null, OPEN_ALWAYS)
    expect(rows[0]!.refusal).not.toBeNull()
  })

  it('everyone moves when the room is empty', () => {
    const rows = planBulkMove(ctx, from, target({ capacity: 8, bookedCount: 0 }), candidates(5), null, OPEN_ALWAYS)
    expect(rows.every((r) => r.refusal === null)).toBe(true)
  })
})
