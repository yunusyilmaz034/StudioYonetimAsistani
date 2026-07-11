import { describe, expect, it } from 'vitest'

import type { Entitlement } from '../../entitlements'
import type { ClassSession, SchedulingPolicy } from '../../scheduling'
import {
  instant,
  money,
  type BranchId,
  type ClassSessionId,
  type CorrelationId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type ReservationId,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import {
  decideAttendance,
  decideAutoResolution,
  decideBooking,
  decideCancellation,
  decideCorrection,
  type DecideContext,
} from './decide'
import type { MemberSnapshot } from '../../members'
import type { CreditEffect, Reservation } from './types'

const NOW = instant(1_000_000_000_000)
const H = 3_600_000
const D = 86_400_000

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const policy = (p: Partial<SchedulingPolicy> = {}): SchedulingPolicy => ({
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: false,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
  ...p,
})

function session(over: Partial<ClassSession> = {}, pol: SchedulingPolicy = policy()): ClassSession {
  return {
    id: 'cls_1' as ClassSessionId,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    serviceId: 'svc_1' as ServiceId,
    roomId: 'rom_1' as RoomId,
    trainerId: null,
    templateId: null,
    category: 'pilates_group',
    startsAt: instant(NOW + 24 * H),
    endsAt: instant(NOW + 25 * H),
    capacity: 8,
    status: 'scheduled',
    cancellation: null,
    policyRef: { serviceId: 'svc_1' as ServiceId, version: 2 },
    policySnapshot: pol,
    bookedCount: 0,
    attendedCount: 0,
    serviceName: 'Reformer',
    roomName: 'Salon A',
    trainerName: null,
    branchName: 'Merkez',
    ...over,
  }
}

function creditEnt(over: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 'ent_1' as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
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
    validFrom: instant(NOW - D),
    validUntil: instant(NOW + 30 * D),
    credits: { granted: 8, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 },
    freeze: null,
    priceAgreed: money(294_000),
    paidTotal: money(0),
    purchasedAt: instant(NOW - D),
    ...over,
  }
}

const SNAP: MemberSnapshot = {
  memberId: 'mem_1' as MemberId,
  displayName: 'Ayşe Y.',
  phoneLast4: '4567',
  membershipStatus: 'active',
}
const bookInput = { reservationId: 'res_1' as ReservationId, memberId: 'mem_1' as MemberId, memberSnapshot: SNAP }

function bookedReservation(over: Partial<Reservation> = {}): Reservation {
  return {
    id: 'res_1' as ReservationId,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    classSessionId: 'cls_1' as ClassSessionId,
    memberId: 'mem_1' as MemberId,
    entitlementId: 'ent_1' as EntitlementId,
    status: 'booked',
    creditEffect: 'held',
    sessionStartsAt: instant(NOW + 24 * H),
    sessionEndsAt: instant(NOW + 25 * H),
    sessionCategory: 'pilates_group',
    memberSnapshot: SNAP,
    bookedAt: NOW,
    bookedBy: ctx.actor,
    resolvedAt: null,
    resolvedBy: null,
    attendanceSource: null,
    policyRef: { policyId: 'svc_1', version: 2 },
    ...over,
  }
}

describe('decideBooking (I-9)', () => {
  it('books, holds a credit, and reports the post-hold count', () => {
    const r = decideBooking(ctx, session(), creditEnt(), bookInput, false)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reservation.status).toBe('booked')
      expect(r.value.reservation.creditEffect).toBe('held')
      expect(r.value.events[0]?.payload).toEqual({
        entitlementId: 'ent_1',
        creditEffect: 'held',
        creditsAvailableAfter: 7,
        sessionStartsAt: instant(NOW + 24 * H),
        bookedCountAfter: 1,
      })
    }
  })
  it('a period entitlement books with no hold', () => {
    const period = creditEnt({
      credits: null,
      productSnapshot: {
        productId: 'prd_2' as ProductId,
        name: 'Fitness 3 Ay',
        category: 'fitness',
        grant: { kind: 'period', durationDays: 90, access: 'unlimited' },
        listPrice: money(600_000),
      },
    })
    const r = decideBooking(ctx, session({ category: 'fitness' }), period, bookInput, false)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reservation.creditEffect).toBe('none')
      expect(r.value.events[0]?.payload).toMatchObject({ creditEffect: 'none', creditsAvailableAfter: null })
    }
  })
  it('refuses a full class (I-9.2)', () => {
    expect(decideBooking(ctx, session({ bookedCount: 8 }), creditEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'class_full', capacity: 8 },
    })
  })
  it('refuses a session in the past (I-9.1)', () => {
    expect(decideBooking(ctx, session({ startsAt: instant(NOW - H) }), creditEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'session_not_bookable' },
    })
  })
  it('refuses when no credits remain (I-9.5, never clamped)', () => {
    const empty = creditEnt({ credits: { granted: 8, held: 8, consumed: 0, restored: 0, revoked: 0, expired: 0 } })
    expect(decideBooking(ctx, session(), empty, bookInput, false)).toEqual({
      ok: false,
      error: { code: 'insufficient_credits', available: 0 },
    })
  })
  it('refuses a package that expires before the session (I-9.4)', () => {
    expect(decideBooking(ctx, session(), creditEnt({ validUntil: instant(NOW + H) }), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'entitlement_expires_before_session' },
    })
  })
  it('refuses a double booking (I-9.6)', () => {
    expect(decideBooking(ctx, session(), creditEnt(), bookInput, true)).toEqual({
      ok: false,
      error: { code: 'already_booked' },
    })
  })
  it('refuses the category wall (I-9.7)', () => {
    expect(decideBooking(ctx, session({ category: 'fitness' }), creditEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'category_mismatch', sessionCategory: 'fitness', entitlementCategory: 'pilates_group' },
    })
  })
  it('refuses a frozen entitlement (I-9.3, I-8)', () => {
    expect(decideBooking(ctx, session(), creditEnt({ status: 'frozen' }), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'entitlement_not_active' },
    })
  })
})

describe('decideCancellation (§7.2 — nothing knows the number six)', () => {
  it('outside the window → cancelled, credit released', () => {
    const r = decideCancellation(ctx, bookedReservation(), session()) // 24h before, window 6h
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reservation.status).toBe('cancelled')
      expect(r.value.events[0]?.type).toBe('reservation.cancelled')
      expect(r.value.events[0]?.payload).toEqual({ hoursBeforeStart: 24, withinWindow: true, creditEffect: 'released' })
    }
  })
  it('inside the window with burn policy → late_cancelled, consumed', () => {
    const r = decideCancellation(ctx, bookedReservation({ sessionStartsAt: instant(NOW + 3 * H) }), session({ startsAt: instant(NOW + 3 * H) }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reservation.status).toBe('late_cancelled')
      expect(r.value.events[0]?.payload).toEqual({ hoursBeforeStart: 3, withinWindow: false, creditEffect: 'consumed' })
    }
  })
  it('inside the window without burn policy → released', () => {
    const s = session({ startsAt: instant(NOW + 3 * H) }, policy({ lateCancellationConsumesCredit: false }))
    const r = decideCancellation(ctx, bookedReservation(), s)
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.value.events[0]?.payload as { creditEffect: CreditEffect }).creditEffect).toBe('released')
  })
  it('a studio-cancelled class always releases (I-14)', () => {
    const r = decideCancellation(ctx, bookedReservation({ sessionStartsAt: instant(NOW + 3 * H) }), session({ startsAt: instant(NOW + 3 * H), status: 'cancelled' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.value.events[0]?.payload as { creditEffect: CreditEffect }).creditEffect).toBe('released')
  })
  it('a period booking moves no credit', () => {
    const r = decideCancellation(ctx, bookedReservation({ creditEffect: 'none' }), session({ startsAt: instant(NOW + 3 * H) }))
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.value.events[0]?.payload as { creditEffect: CreditEffect }).creditEffect).toBe('none')
  })
  it('refuses to cancel an already-resolved reservation', () => {
    expect(decideCancellation(ctx, bookedReservation({ status: 'attended' }), session())).toEqual({
      ok: false,
      error: { code: 'reservation_not_open' },
    })
  })
})

describe('decideAttendance (manual, source trainer)', () => {
  it('attended consumes the credit', () => {
    const r = decideAttendance(ctx, bookedReservation(), session({ startsAt: instant(NOW - H) }), 'attended')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reservation.status).toBe('attended')
      expect(r.value.reservation.attendanceSource).toBe('trainer')
      expect(r.value.events[0]?.type).toBe('reservation.attended')
      expect(r.value.events[0]?.payload).toEqual({ source: 'trainer', minutesAfterStart: 60, creditEffect: 'consumed' })
    }
  })
  it('no_show burns per policy (here: does not)', () => {
    const r = decideAttendance(ctx, bookedReservation(), session(), 'no_show')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload).toEqual({ source: 'trainer', creditEffect: 'released' })
  })
  it('a period booking (held nothing) moves no credit when marked attended', () => {
    const r = decideAttendance(ctx, bookedReservation({ creditEffect: 'none' }), session({ startsAt: instant(NOW - H) }), 'attended')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload).toEqual({ source: 'trainer', minutesAfterStart: 60, creditEffect: 'none' })
  })
})

describe('decideAutoResolution (AD-38 — never emits reservation.attended)', () => {
  // A session that ended an hour ago; grace 15m ⇒ already resolvable at NOW.
  const ended = (pol: SchedulingPolicy = policy()) =>
    session({ startsAt: instant(NOW - 2 * H), endsAt: instant(NOW - H) }, pol)
  const held = () => creditEnt({ credits: { granted: 8, held: 1, consumed: 0, restored: 0, revoked: 0, expired: 0 } })

  it('applies the policy default and emits auto_resolved with system_default', () => {
    const r = decideAutoResolution(ctx, bookedReservation(), ended(), held())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.events[0]?.type).toBe('reservation.auto_resolved')
      expect(r.value.reservation.attendanceSource).toBe('system_default')
      expect(r.value.events[0]?.payload).toEqual({
        outcome: 'attended',
        source: 'system_default',
        creditEffect: 'consumed',
        creditsAvailableAfter: 7,
      })
    }
  })
  it('a no_show-default studio releases when policy does not burn', () => {
    const s = ended(policy({ attendanceDefaultOutcome: 'no_show', noShowConsumesCredit: false }))
    const r = decideAutoResolution(ctx, bookedReservation(), s, held())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload).toEqual({ outcome: 'no_show', source: 'system_default', creditEffect: 'released', creditsAvailableAfter: 8 })
  })

  // Grace window (Doc 2 §8): eligible only at endsAt + autoResolveAfterMinutes.
  // `exactly grace` resolves; one ms earlier is refused. Nothing knows the minutes.
  it('refuses before the grace window has elapsed', () => {
    const justEnded = session({ startsAt: instant(NOW - H), endsAt: instant(NOW - 14 * 60_000) }) // ended 14m ago, grace 15m
    const r = decideAutoResolution(ctx, bookedReservation(), justEnded, held())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('auto_resolve_too_early')
  })
  it('resolves at exactly endsAt + grace, not one ms before', () => {
    const grace = 15 * 60_000
    const atBoundary = session({ startsAt: instant(NOW - 2 * H), endsAt: instant(NOW - grace) }) // resolvableAt === NOW
    expect(decideAutoResolution(ctx, bookedReservation(), atBoundary, held()).ok).toBe(true)

    const oneMsShort = session({ startsAt: instant(NOW - 2 * H), endsAt: instant(NOW - grace + 1) })
    const r = decideAutoResolution(ctx, bookedReservation(), oneMsShort, held())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('auto_resolve_too_early')
  })
  it('refuses a reservation that is no longer booked', () => {
    expect(decideAutoResolution(ctx, bookedReservation({ status: 'attended' }), ended(), held())).toEqual({
      ok: false,
      error: { code: 'reservation_not_open' },
    })
  })
  it('a period booking auto-resolves with no credit movement', () => {
    const period = creditEnt({ credits: null })
    const r = decideAutoResolution(ctx, bookedReservation({ creditEffect: 'none' }), ended(), period)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.events[0]?.payload).toEqual({
        outcome: 'attended',
        source: 'system_default',
        creditEffect: 'none',
        creditsAvailableAfter: null,
      })
    }
  })
})

describe('decideCorrection (compensating, never a silent edit)', () => {
  it('records from → to with a reason and source correction', () => {
    const r = decideCorrection(ctx, bookedReservation({ status: 'no_show' }), 'attended', 'trainer marked wrong roster')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reservation.status).toBe('attended')
      expect(r.value.reservation.attendanceSource).toBe('correction')
      expect(r.value.events[0]?.payload).toEqual({ from: 'no_show', to: 'attended', reason: 'trainer marked wrong roster', source: 'correction' })
    }
  })
  it('refuses an empty reason', () => {
    expect(decideCorrection(ctx, bookedReservation({ status: 'no_show' }), 'attended', '  ')).toEqual({
      ok: false,
      error: { code: 'reason_required' },
    })
  })
  it('refuses to correct a still-booked (unresolved) reservation', () => {
    expect(decideCorrection(ctx, bookedReservation({ status: 'booked' }), 'attended', 'reason')).toEqual({
      ok: false,
      error: { code: 'reservation_not_resolved' },
    })
  })
})
