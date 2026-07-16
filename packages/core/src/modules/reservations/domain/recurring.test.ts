import { describe, expect, it } from 'vitest'

import { computeRecurringPlan } from './recurring'
import type { Entitlement } from '../../entitlements'
import type { ClassSession } from '../../scheduling'
import type { Reservation } from './types'
import {
  instant,
  localDateAt,
  money,
  type BranchId,
  type ClassSessionId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type ReservationId,
  type RoomId,
  type ServiceId,
  type StudioId,
} from '../../../shared'

const NOW = instant(1_000_000_000_000)
const H = 3_600_000
const D = 86_400_000
const WEEK = 7 * D
const OFFSET = 180

const session = (over: Partial<ClassSession> = {}): ClassSession => ({
  id: 'cls_1' as ClassSessionId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  serviceId: 'svc_1' as ServiceId,
  roomId: 'rom_1' as RoomId,
  trainerId: null,
  templateId: null,
  assignedMemberId: null,
  category: 'pilates_group',
  startsAt: instant(NOW + 2 * D),
  endsAt: instant(NOW + 2 * D + H),
  capacity: 8,
  status: 'scheduled',
  cancellation: null,
  policyRef: { serviceId: 'svc_1' as ServiceId, version: 2 },
  policySnapshot: {
    maxDaysInAdvance: 90,
    cancellationWindowHours: 6,
    cancellationWindowSource: 'service',
    lateCancellationConsumesCredit: true,
    noShowConsumesCredit: false,
    attendanceDefaultOutcome: 'attended',
    autoResolveAfterMinutes: 15,
    allowMemberSelfBooking: false,
  },
  bookedCount: 0,
  attendedCount: 0,
  serviceName: 'Reformer',
  roomName: 'A',
  trainerName: null,
  branchName: 'Merkez',
  ...over,
})

const ent = (credits: number, over: Partial<Entitlement> = {}): Entitlement => ({
  id: 'ent_1' as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1' as MemberId,
  productId: 'prd_1' as ProductId,
  productSnapshot: {
    productId: 'prd_1' as ProductId,
    name: 'Pilates 8',
    category: 'pilates_group',
    grant: { kind: 'credits', credits: 8, validForDays: 60 },
    listPrice: money(420_000),
  },
  policyRef: { policyId: 'pol_1', version: 3 },
  status: 'active',
  validFrom: instant(NOW - D),
  validUntil: instant(NOW + 120 * D),
  credits: { granted: credits, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 },
  freeze: null,
  cancellationLedger: { used: 0, refunded: 0 },
  priceAgreed: money(294_000),
  paidTotal: money(0),
  manualPayment: null,
  purchasedAt: instant(NOW - D),
  ...over,
})

const seed = session()
// The four following weeks, all scheduled and empty.
const fourWeeks = (over: (k: number) => Partial<ClassSession> = () => ({})): ClassSession[] =>
  [1, 2, 3, 4].map((k) =>
    session({
      id: `cls_${k + 1}` as ClassSessionId,
      startsAt: instant(seed.startsAt + k * WEEK),
      endsAt: instant(seed.endsAt + k * WEEK),
      ...over(k),
    }),
  )

const base = {
  seed,
  memberId: 'mem_1' as MemberId,
  memberReservations: [] as readonly Reservation[],
  weeks: 4,
  now: NOW,
  utcOffsetMinutes: OFFSET,
  skipDates: new Set<string>(),
}

describe('computeRecurringPlan (D18)', () => {
  it('books the same slot for four weeks', () => {
    const plan = computeRecurringPlan({ ...base, sessions: fourWeeks(), entitlements: [ent(8)] })
    expect(plan.toBook).toHaveLength(4)
    expect(plan.skipped).toHaveLength(0)
    expect(plan.toBook.map((t) => t.weekOffset)).toEqual([1, 2, 3, 4])
  })

  it('NEVER invents a session: a week the studio never scheduled is skipped by name', () => {
    const sessions = fourWeeks().filter((s) => s.id !== 'cls_3') // week 2 does not exist
    const plan = computeRecurringPlan({ ...base, sessions, entitlements: [ent(8)] })
    expect(plan.toBook).toHaveLength(3)
    expect(plan.skipped).toEqual([
      expect.objectContaining({ weekOffset: 2, reason: 'no_session', sessionId: null }),
    ])
  })

  it('stops when the credits run out — and says so', () => {
    const plan = computeRecurringPlan({ ...base, sessions: fourWeeks(), entitlements: [ent(2)] })
    expect(plan.toBook).toHaveLength(2)
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'no_eligible_entitlement',
      'no_eligible_entitlement',
    ])
  })

  it('skips a cancelled class, a full class and one she is already in — each by name', () => {
    const sessions = fourWeeks((k) =>
      k === 1
        ? { status: 'cancelled' }
        : k === 2
          ? { bookedCount: 8, capacity: 8 }
          : {},
    )
    const already: Reservation = {
      id: 'res_x' as ReservationId,
      studioId: 'std_1' as StudioId,
      branchId: 'brn_1' as BranchId,
      classSessionId: 'cls_4' as ClassSessionId, // week 3
      memberId: 'mem_1' as MemberId,
      entitlementId: 'ent_1' as EntitlementId,
      status: 'booked',
      creditEffect: 'held',
      sessionStartsAt: instant(seed.startsAt + 3 * WEEK),
      sessionEndsAt: instant(seed.endsAt + 3 * WEEK),
      sessionCategory: 'pilates_group',
      memberSnapshot: {
        memberId: 'mem_1' as MemberId,
        displayName: 'Ayşe Y.',
        phoneLast4: '4567',
        membershipStatus: 'active',
      },
      bookedAt: NOW,
      bookedBy: { type: 'receptionist', id: 'usr_1' as never },
      resolvedAt: null,
      resolvedBy: null,
      attendanceSource: null,
      policyRef: { policyId: 'svc_1', version: 2 },
    }
    const plan = computeRecurringPlan({
      ...base,
      sessions,
      entitlements: [ent(8)],
      memberReservations: [already],
    })
    expect(plan.toBook.map((t) => t.weekOffset)).toEqual([4])
    expect(plan.skipped.map((s) => [s.weekOffset, s.reason])).toEqual([
      [1, 'session_cancelled'],
      [2, 'session_full'],
      [3, 'already_booked'],
    ])
  })

  it('skips a day the owner ticked off (D23) — a holiday is never skipped on its own', () => {
    const weeks = fourWeeks()
    const week2Date = localDateAt(weeks[1]!.startsAt, OFFSET) as string
    const plan = computeRecurringPlan({
      ...base,
      sessions: weeks,
      entitlements: [ent(8)],
      skipDates: new Set([week2Date]),
    })
    expect(plan.toBook).toHaveLength(3)
    expect(plan.skipped).toEqual([expect.objectContaining({ weekOffset: 2, reason: 'calendar_day' })])
  })

  it('refuses to retime her: a class at another hour is not the same slot', () => {
    const shifted = fourWeeks((k) => (k === 1 ? { startsAt: instant(seed.startsAt + WEEK + 3 * H) } : {}))
    const plan = computeRecurringPlan({ ...base, sessions: shifted, entitlements: [ent(8)] })
    expect(plan.toBook).toHaveLength(3)
    expect(plan.skipped).toEqual([expect.objectContaining({ weekOffset: 1, reason: 'no_session' })])
  })

  it('every week lands in exactly one bucket — nothing is dropped', () => {
    const plan = computeRecurringPlan({ ...base, sessions: fourWeeks(), entitlements: [ent(1)], weeks: 4 })
    expect(plan.toBook.length + plan.skipped.length).toBe(4)
  })
})
