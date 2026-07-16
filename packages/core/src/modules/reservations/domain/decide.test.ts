import { describe, expect, it } from 'vitest'

import type { Entitlement } from '../../entitlements'
import type { ClassSession, SessionPolicySnapshot } from '../../scheduling'
import {
  instant,
  isOverrideActiveAt,
  money,
  type BranchId,
  type ClassSessionId,
  type CorrelationId,
  type EntitlementId,
  type LocalDate,
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
  decideMove,
  type BookingLimits,
  type DecideContext,
} from './decide'
import { localMinuteOfDay, localWeekday, resolveReservationPolicy } from './policy'
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

const policy = (p: Partial<SessionPolicySnapshot> = {}): SessionPolicySnapshot => ({
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

function session(over: Partial<ClassSession> = {}, pol: SessionPolicySnapshot = policy()): ClassSession {
  return {
    id: 'cls_1' as ClassSessionId,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    serviceId: 'svc_1' as ServiceId,
    roomId: 'rom_1' as RoomId,
    trainerId: null,
    templateId: null,
    assignedMemberId: null,
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
    cancellationLedger: { used: 0, refunded: 0 },
    priceAgreed: money(294_000),
    paidTotal: money(0),
    manualPayment: null,
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

// AG-1 — booking answers to the studio's opening hours. These cases test the OTHER rules, so the
// studio has none configured (`null`): a studio that has not told us when it is open has not asked us
// to police it. The hours themselves are tested in `working-hours.test.ts`.
const OPEN_ALWAYS = { hours: null, utcOffsetMinutes: 180, specialWorkingDates: new Set<LocalDate>() }
const book = (
  session: ClassSession,
  entitlement: Entitlement,
  input: Parameters<typeof decideBooking>[3],
  memberHasBooked: boolean,
) => decideBooking(ctx, session, entitlement, input, memberHasBooked, OPEN_ALWAYS)

describe('decideBooking (I-9)', () => {
  it('books, holds a credit, and reports the post-hold count', () => {
    const r = book(session(), creditEnt(), bookInput, false)
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
    const r = book(session({ category: 'fitness' }), period, bookInput, false)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reservation.creditEffect).toBe('none')
      expect(r.value.events[0]?.payload).toMatchObject({ creditEffect: 'none', creditsAvailableAfter: null })
    }
  })
  it('refuses a full class (I-9.2)', () => {
    expect(book(session({ bookedCount: 8 }), creditEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'class_full', capacity: 8 },
    })
  })
  it('refuses a session in the past (I-9.1)', () => {
    expect(book(session({ startsAt: instant(NOW - H) }), creditEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'session_not_bookable' },
    })
  })
  it('refuses when no credits remain (I-9.5, never clamped)', () => {
    const empty = creditEnt({ credits: { granted: 8, held: 8, consumed: 0, restored: 0, revoked: 0, expired: 0 } })
    expect(book(session(), empty, bookInput, false)).toEqual({
      ok: false,
      error: { code: 'insufficient_credits', available: 0 },
    })
  })
  it('refuses a package that expires before the session (I-9.4)', () => {
    expect(book(session(), creditEnt({ validUntil: instant(NOW + H) }), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'entitlement_expires_before_session' },
    })
  })
  it('refuses a double booking (I-9.6)', () => {
    expect(book(session(), creditEnt(), bookInput, true)).toEqual({
      ok: false,
      error: { code: 'already_booked' },
    })
  })
  it('refuses the category wall (I-9.7)', () => {
    expect(book(session({ category: 'fitness' }), creditEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'category_mismatch', sessionCategory: 'fitness', entitlementCategory: 'pilates_group' },
    })
  })
  it('refuses a frozen entitlement (I-9.3, I-8)', () => {
    expect(book(session(), creditEnt({ status: 'frozen' }), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'entitlement_not_active' },
    })
  })

  // ── D12 / I-9.8 — the service wall ────────────────────────────────────────────
  const withServices = (ids: readonly ServiceId[]) =>
    creditEnt({
      productSnapshot: {
        productId: 'prd_1' as ProductId,
        name: 'Reformer 8',
        category: 'pilates_group',
        grant: { kind: 'credits', credits: 8, validForDays: 30 },
        listPrice: money(420_000),
        serviceIds: ids,
      },
    })

  it('books when the package covers the session’s service (I-9.8)', () => {
    const r = book(session(), withServices(['svc_1' as ServiceId]), bookInput, false)
    expect(r.ok).toBe(true)
  })

  it('refuses a service the package does not cover (I-9.8)', () => {
    expect(book(session(), withServices(['svc_9' as ServiceId]), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'service_not_covered', sessionServiceId: 'svc_1' },
    })
  })

  it('a LEGACY entitlement (no service list) still books — its category-wide right is intact', () => {
    // Sold before D12. It is never narrowed after the fact; `creditEnt()` carries no serviceIds.
    const r = book(session(), creditEnt(), bookInput, false)
    expect(r.ok).toBe(true)
  })

  it('a package that names NO service grants no access (empty ≠ everything)', () => {
    expect(book(session(), withServices([]), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'service_not_covered', sessionServiceId: 'svc_1' },
    })
  })

  // ── D13 / I-9.9 — PT ownership ────────────────────────────────────────────────
  const ptSession = (assignedMemberId: MemberId | null) =>
    session({ category: 'private', assignedMemberId })
  const ptEnt = () =>
    creditEnt({
      productSnapshot: {
        productId: 'prd_pt' as ProductId,
        name: 'PT 8',
        category: 'private',
        grant: { kind: 'credits', credits: 8, validForDays: 60 },
        listPrice: money(640_000),
        serviceIds: ['svc_1' as ServiceId],
      },
    })

  it('the assigned member books her own PT slot', () => {
    const r = book(ptSession('mem_1' as MemberId), ptEnt(), bookInput, false)
    expect(r.ok).toBe(true)
  })

  it('a RESERVED PT slot refuses everyone except its member — even with a valid PT package', () => {
    // bookInput books mem_1; the slot is mem_2's. Reception cannot put the wrong member in it
    // either — this refuses by MEMBER, not by actor.
    expect(book(ptSession('mem_2' as MemberId), ptEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'session_not_assigned_to_member' },
    })
  })

  it('an OPEN PT slot (unassigned) is bookable by any eligible member — it is not hidden', () => {
    // D13 final (owner): null does NOT mean "unavailable". It is the default, and it is open.
    const r = book(ptSession(null), ptEnt(), bookInput, false)
    expect(r.ok).toBe(true)
  })

  it('booking an OPEN PT slot does NOT assign it — the field stays null', () => {
    // Ownership is never acquired by booking. A second member may still take the next seat if
    // capacity allows (a future partner/duo PT has capacity 2).
    const open = ptSession(null)
    const r = book(open, ptEnt(), bookInput, false)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(open.assignedMemberId).toBeNull() // the decider produced no assignment
      expect(r.value.events.every((e) => e.type !== 'class_session.assigned')).toBe(true)
      expect(r.value.reservation.classSessionId).toBe('cls_1')
    }
  })

  it('an OPEN PT slot fills by CAPACITY, not by ownership', () => {
    // capacity 2, one seat taken → still bookable. Nothing about assignment is consulted.
    const duo = session({ category: 'private', assignedMemberId: null, capacity: 2, bookedCount: 1 })
    expect(book(duo, ptEnt(), bookInput, false).ok).toBe(true)
    const full = session({ category: 'private', assignedMemberId: null, capacity: 2, bookedCount: 2 })
    expect(book(full, ptEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'class_full', capacity: 2 },
    })
  })

  it('reception may book an eligible member into an OPEN PT slot (ctx.actor is reception)', () => {
    // The refusal is by MEMBER, not by actor — and an open slot has no member to refuse for.
    expect(ctx.actor.type).toBe('receptionist')
    expect(book(ptSession(null), ptEnt(), bookInput, false).ok).toBe(true)
  })

  it('the ownership refusal precedes the capacity check — a full slot that is not hers still says so', () => {
    const full = session({ category: 'private', assignedMemberId: 'mem_2' as MemberId, bookedCount: 8 })
    expect(book(full, ptEnt(), bookInput, false)).toEqual({
      ok: false,
      error: { code: 'session_not_assigned_to_member' },
    })
  })

  it('the category wall is checked BEFORE the service wall — the coarser refusal wins', () => {
    expect(
      book(session({ category: 'fitness' }), withServices(['svc_9' as ServiceId]), bookInput, false),
    ).toEqual({
      ok: false,
      error: { code: 'category_mismatch', sessionCategory: 'fitness', entitlementCategory: 'pilates_group' },
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
  const ended = (pol: SessionPolicySnapshot = policy()) =>
    session({ startsAt: instant(NOW - 2 * H), endsAt: instant(NOW - H) }, pol)

  // ── I-27 (v1.22) — the studio cancelled the class ────────────────────────────────────────
  //
  // This is the defect v1.22 opened with: the sweep used to presume `attended` here and CONSUME
  // the credit for a class that never happened. A presumption is never written down as an
  // observation (#11), and presuming attendance at a cancelled class is the purest form of it.
  describe('I-27 — a reservation on a CANCELLED session', () => {
    const cancelledSession = (pol: SessionPolicySnapshot = policy()) =>
      session({ startsAt: instant(NOW - 2 * H), endsAt: instant(NOW - H), status: 'cancelled' }, pol)

    it('is RELEASED, never consumed — the studio cancelled it, not the member', () => {
      const r = decideAutoResolution(ctx, bookedReservation(), cancelledSession(), creditEnt())
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.reservation.status).toBe('cancelled')
        expect(r.value.reservation.creditEffect).toBe('released')
        expect(r.value.events[0]?.type).toBe('reservation.cancelled')
      }
    })

    it('never emits an attendance event for a class that did not happen', () => {
      const r = decideAutoResolution(ctx, bookedReservation(), cancelledSession(), creditEnt())
      expect(r.ok).toBe(true)
      if (r.ok) {
        const types = r.value.events.map((e) => e.type)
        expect(types).not.toContain('reservation.auto_resolved')
        expect(types).not.toContain('reservation.attended')
      }
    })

    it('releases even under a no_show default — the default is about ABSENCE, not cancellation', () => {
      // With `attendanceDefaultOutcome: 'no_show'` + `noShowConsumesCredit`, the old path would
      // still have burned the credit. A cancelled class is neither attendance nor absence.
      const pol = policy({ attendanceDefaultOutcome: 'no_show', noShowConsumesCredit: true })
      const r = decideAutoResolution(ctx, bookedReservation(), cancelledSession(pol), creditEnt())
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.reservation.creditEffect).toBe('released')
    })

    it('does not wait for the grace window — there is nothing to wait for', () => {
      // The class was cancelled; no trainer is going to mark it. Releasing immediately is what
      // stops the reservation from sitting `booked` against a session that will never run.
      const justCancelled = session(
        { startsAt: instant(NOW + H), endsAt: instant(NOW + 2 * H), status: 'cancelled' },
      )
      const r = decideAutoResolution(ctx, bookedReservation(), justCancelled, creditEnt())
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.reservation.creditEffect).toBe('released')
    })

    it('a period booking held nothing, so nothing moves', () => {
      const r = decideAutoResolution(
        ctx,
        bookedReservation({ creditEffect: 'none' }),
        cancelledSession(),
        creditEnt({ credits: null }),
      )
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.reservation.creditEffect).toBe('none')
    })

    it('an already-resolved reservation is still refused — history is never re-resolved', () => {
      const r = decideAutoResolution(
        ctx,
        bookedReservation({ status: 'attended' }),
        cancelledSession(),
        creditEnt(),
      )
      expect(r).toEqual({ ok: false, error: { code: 'reservation_not_open' } })
    })
  })
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

// ── D19 — MOVE (v1.22). A move is not a cancel + a book: the same hold points at another class.
describe('decideMove', () => {
  const target = (over: Partial<ClassSession> = {}, pol = policy()) =>
    session({ id: 'cls_2' as ClassSessionId, startsAt: instant(NOW + 48 * H), endsAt: instant(NOW + 49 * H), ...over }, pol)

  it('moves inside the free window: one moved event, the credit never moves', () => {
    const r = decideMove(ctx, bookedReservation(), session(), target(), creditEnt(), false, OPEN_ALWAYS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events).toHaveLength(1)
    expect(r.value.events[0]?.type).toBe('reservation.moved')
    expect(r.value.reservation.status).toBe('booked')
    expect(r.value.reservation.creditEffect).toBe('held') // unchanged — this is the whole point
    expect(r.value.reservation.classSessionId).toBe('cls_2')
    expect(r.value.reservation.entitlementId).toBe('ent_1')
    expect(r.value.events[0]?.payload).toMatchObject({ withinWindow: true, overrideReason: null })
  })

  it('refuses a member moving past the free-move window', () => {
    const memberCtx: DecideContext = { ...ctx, actor: { type: 'member', id: 'mem_1' as MemberId } }
    const late = session({ startsAt: instant(NOW + 2 * H), endsAt: instant(NOW + 3 * H) }) // window is 6h
    const r = decideMove(memberCtx, bookedReservation(), late, target(), creditEnt(), false, OPEN_ALWAYS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('outside_cancellation_window')
  })

  it('refuses STAFF moving past the window without a reason, and allows it with one', () => {
    const late = session({ startsAt: instant(NOW + 2 * H), endsAt: instant(NOW + 3 * H) })
    const bare = decideMove(ctx, bookedReservation(), late, target(), creditEnt(), false, OPEN_ALWAYS)
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.error.code).toBe('reason_required')

    const withReason = decideMove(ctx, bookedReservation(), late, target(), creditEnt(), false, OPEN_ALWAYS, {
      overrideReason: 'Üye aradı, eğitmen onayladı',
    })
    expect(withReason.ok).toBe(true)
    if (!withReason.ok) return
    expect(withReason.value.events[0]?.payload).toMatchObject({
      withinWindow: false,
      overrideReason: 'Üye aradı, eğitmen onayladı',
    })
    // Even an override never burns a credit — that would be a late cancel wearing a nicer word.
    expect(withReason.value.reservation.creditEffect).toBe('held')
  })

  it('exactly at the window boundary is INSIDE the window', () => {
    const boundary = session({ startsAt: instant(NOW + 6 * H), endsAt: instant(NOW + 7 * H) })
    const r = decideMove(ctx, bookedReservation(), boundary, target(), creditEnt(), false, OPEN_ALWAYS)
    expect(r.ok).toBe(true)
  })

  const refusals: readonly [string, () => ClassSession, Partial<Entitlement>, boolean, string][] = [
    ['a full target class', () => target({ bookedCount: 8, capacity: 8 }), {}, false, 'class_full'],
    ['a cancelled target class', () => target({ status: 'cancelled' }), {}, false, 'session_not_bookable'],
    ['a target in the past', () => target({ startsAt: instant(NOW - H), endsAt: instant(NOW) }), {}, false, 'session_not_bookable'],
    ["another member's PT slot", () => target({ assignedMemberId: 'mem_9' as MemberId }), {}, false, 'session_not_assigned_to_member'],
    ['a target in another category', () => target({ category: 'fitness' }), {}, false, 'category_mismatch'],
    ['a target the package expires before', () => target(), { validUntil: instant(NOW + H) }, false, 'entitlement_expires_before_session'],
    ['a class she is already booked into', () => target(), {}, true, 'already_booked'],
  ]
  it.each(refusals)('refuses %s', (_label, targetOf, entOver, alreadyBooked, code) => {
    const r = decideMove(ctx, bookedReservation(), session(), targetOf(), creditEnt(entOver), alreadyBooked, OPEN_ALWAYS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe(code)
  })

  it('a studio-cancelled origin is always inside the window — she is not punished for our cancellation', () => {
    const cancelled = session({ status: 'cancelled', startsAt: instant(NOW + H), endsAt: instant(NOW + 2 * H) })
    const r = decideMove(ctx, bookedReservation(), cancelled, target(), creditEnt(), false, OPEN_ALWAYS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toMatchObject({ withinWindow: true })
  })

  it('refuses moving a reservation that is no longer open', () => {
    const r = decideMove(ctx, bookedReservation({ status: 'attended' }), session(), target(), creditEnt(), false, OPEN_ALWAYS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('reservation_not_open')
  })
})

// AG-1 — THE SECOND GATE. A seat cannot be taken at an hour the studio is shut.
//
// Why booking is checked at all, when the session could not have been created outside the hours: the
// hours CHANGE. A studio that used to close at 22:00 and now closes at 21:00 still has last month's
// 21:30 classes on its calendar, and nobody should be able to put a new member into one of them.
describe('AG-1 — çalışma saatleri, rezervasyon alırken', () => {
  const TR = 180
  // 2024-01-01T00:00:00+03:00 — a MONDAY, in Istanbul. Written as an epoch literal because `Date` is
  // banned in the domain (D2): a decision function that can read the clock cannot be exhaustively
  // tested, and the ban holds for its tests too.
  const MONDAY = 1_704_056_400_000
  const at = (h: number, m = 0) => instant(MONDAY + h * 3_600_000 + m * 60_000)
  const HOURS = {
    0: null,
    1: { open: '10:00', close: '21:00' },
    2: { open: '10:00', close: '21:00' },
    3: { open: '10:00', close: '21:00' },
    4: { open: '10:00', close: '21:00' },
    5: { open: '10:00', close: '21:00' },
    6: { open: '11:00', close: '17:00' },
  } as const
  const OPEN = { hours: HOURS as never, utcOffsetMinutes: TR, specialWorkingDates: new Set<LocalDate>() }

  // `ctx.now` must be before the class, and the package must outlive it — otherwise the booking is
  // refused for a reason that has nothing to do with opening hours, and the test proves nothing.
  const early: DecideContext = { ...ctx, now: instant(MONDAY - 3_600_000) }
  const ent = () => creditEnt({ validUntil: instant(MONDAY + 30 * 86_400_000) })

  const monday = (startH: number, endH: number) =>
    session({ startsAt: at(startH), endsAt: at(endH) })

  it('books a class inside the studio’s hours', () => {
    const r = decideBooking(early, monday(19, 20), ent(), bookInput, false, OPEN)
    expect(r.ok).toBe(true)
  })

  it('REFUSES a seat in a class that runs past closing', () => {
    const r = decideBooking(early, monday(20, 22), ent(), bookInput, false, OPEN)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('outside_working_hours')
  })

  it('refuses a seat on a day the studio is closed', () => {
    const sunday = session({
      startsAt: instant(MONDAY - 12 * 3_600_000),
      endsAt: instant(MONDAY - 11 * 3_600_000),
    })
    const veryEarly: DecideContext = { ...ctx, now: instant(MONDAY - 24 * 3_600_000) }
    const r = decideBooking(veryEarly, sunday, ent(), bookInput, false, OPEN)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('studio_closed_on_day')
  })

  it('refuses MOVING a member into a class outside the hours — the target is a seat like any other', () => {
    const badTarget = session({ id: 'cls_2' as ClassSessionId, startsAt: at(20), endsAt: at(22) })
    const from = session({ startsAt: at(19), endsAt: at(20) })
    const r = decideMove(
      early,
      bookedReservation({ sessionStartsAt: at(19) }),
      from,
      badTarget,
      ent(),
      false,
      OPEN,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('outside_working_hours')
  })
})

// ── Package Rules 2.0 (Plus Phase 3) ─────────────────────────────────────────────────────────
const noLimits: BookingLimits = {
  policy: {
    cancellationAllowance: null,
    dailyReservationLimit: null,
    activeReservationLimit: null,
    allowedWeekdays: null,
    allowedHourRanges: null,
    allowedTrainerIds: null,
  },
  sessionWeekday: 1,
  sessionStartMinutes: 600,
  memberDayReservationCount: 0,
  memberActiveReservationCount: 0,
}
const withLimits = (over: Partial<BookingLimits>): BookingLimits => ({
  ...noLimits,
  ...over,
  policy: { ...noLimits.policy, ...(over.policy ?? {}) },
})
const bookL = (limits: BookingLimits) => decideBooking(ctx, session(), creditEnt(), bookInput, false, OPEN_ALWAYS, limits)

describe('resolveReservationPolicy — studio → package → member', () => {
  it('uses the package rule when there is no override', () => {
    const eff = resolveReservationPolicy(
      { cancellationAllowanceCount: 5, dailyReservationLimit: 2, activeReservationLimit: 4 },
      null,
    )
    expect(eff.cancellationAllowance).toBe(5)
    expect(eff.dailyReservationLimit).toBe(2)
    expect(eff.activeReservationLimit).toBe(4)
    expect(eff.allowedWeekdays).toBeNull()
  })
  it('the member override wins over the package (tighter OR looser)', () => {
    const eff = resolveReservationPolicy(
      { cancellationAllowanceCount: null, dailyReservationLimit: 2, activeReservationLimit: 4 },
      { cancellationAllowance: 3, dailyReservationLimit: 1, allowedWeekdays: [1, 2, 3, 4, 5] },
    )
    expect(eff.cancellationAllowance).toBe(3) // override turned unlimited into 3
    expect(eff.dailyReservationLimit).toBe(1) // override tightened
    expect(eff.activeReservationLimit).toBe(4) // untouched → inherits the package
    expect(eff.allowedWeekdays).toEqual([1, 2, 3, 4, 5])
  })
  it('an override that says nothing inherits everything', () => {
    const eff = resolveReservationPolicy(
      { cancellationAllowanceCount: 5, dailyReservationLimit: 2, activeReservationLimit: 4 },
      { reason: 'vip', note: 'x' } as never,
    )
    expect(eff.cancellationAllowance).toBe(5)
    expect(eff.dailyReservationLimit).toBe(2)
  })
})

describe('localWeekday / localMinuteOfDay (studio-local, pure)', () => {
  it('resolves the studio-local weekday and minute of day', () => {
    // 1_000_000_000_000 = 2001-09-09 01:46:40 UTC; +180min ⇒ 04:46 Istanbul, a Sunday (0).
    expect(localWeekday(1_000_000_000_000, 180)).toBe(0)
    expect(localMinuteOfDay(1_000_000_000_000, 180)).toBe(286) // 04:46
  })
})

describe('decideBooking — package/member limits (Phase 3)', () => {
  it('allows a booking that satisfies every limit', () => {
    const r = bookL(withLimits({ policy: { ...noLimits.policy, dailyReservationLimit: 2 }, memberDayReservationCount: 1 }))
    expect(r.ok).toBe(true)
  })
  it('refuses a day the member is not allowed to book', () => {
    const r = bookL(withLimits({ policy: { ...noLimits.policy, allowedWeekdays: [1, 2, 3] }, sessionWeekday: 6 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('day_not_allowed')
  })
  it('refuses a time outside the allowed hour range', () => {
    const r = bookL(
      withLimits({ policy: { ...noLimits.policy, allowedHourRanges: [{ startMinutes: 600, endMinutes: 960 }] }, sessionStartMinutes: 1000 }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('time_not_allowed')
  })
  it('refuses when the daily reservation limit is reached', () => {
    const r = bookL(withLimits({ policy: { ...noLimits.policy, dailyReservationLimit: 2 }, memberDayReservationCount: 2 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('daily_reservation_limit_reached')
  })
  it('refuses when the active reservation limit is reached', () => {
    const r = bookL(withLimits({ policy: { ...noLimits.policy, activeReservationLimit: 4 }, memberActiveReservationCount: 4 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('active_reservation_limit_reached')
  })
})

describe('decideCancellation — free-cancellation allowance (Phase 3)', () => {
  const inWindow = () => bookedReservation() // 24h before, window 6h ⇒ in-window
  it('unlimited allowance never gates and never charges', () => {
    const r = decideCancellation(ctx, inWindow(), session(), { allowance: null, usedNet: 3 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.allowanceConsumed).toBe(false)
  })
  it('a finite allowance is spent on an in-window cancel (5 rights: the 1st and 5th pass)', () => {
    const first = decideCancellation(ctx, inWindow(), session(), { allowance: 5, usedNet: 0 })
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.value.allowanceConsumed).toBe(true)
    const fifth = decideCancellation(ctx, inWindow(), session(), { allowance: 5, usedNet: 4 })
    expect(fifth.ok).toBe(true)
  })
  it('refuses the 6th in-window cancel — the reservation stays, no credit is burned', () => {
    const r = decideCancellation(ctx, inWindow(), session(), { allowance: 5, usedNet: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('cancellation_allowance_exhausted')
  })
  it('a LATE cancel does not spend the allowance (only in-window counts)', () => {
    const late = bookedReservation({ sessionStartsAt: instant(NOW + 3 * H) })
    const r = decideCancellation(ctx, late, session({ startsAt: instant(NOW + 3 * H) }), { allowance: 5, usedNet: 4 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.allowanceConsumed).toBe(false)
  })
  it('a studio-cancelled class never spends the allowance', () => {
    const r = decideCancellation(ctx, inWindow(), session({ status: 'cancelled' }), { allowance: 5, usedNet: 5 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.allowanceConsumed).toBe(false)
  })
})

// ── Member Override — Phase 4 (trainer restriction + validity window) ────────────────────────
describe('decideBooking — trainer restriction (Phase 4)', () => {
  const withTrainer = (trainerId: string | null, allowed: readonly string[] | null) =>
    decideBooking(
      ctx,
      session({ trainerId: trainerId as never }),
      creditEnt(),
      bookInput,
      false,
      OPEN_ALWAYS,
      withLimits({ policy: { ...noLimits.policy, allowedTrainerIds: allowed } }),
    )
  it('allows a session with an allowed trainer', () => {
    expect(withTrainer('stf_isil', ['stf_isil', 'stf_reyhan']).ok).toBe(true)
  })
  it('refuses a session with a trainer not on the whitelist', () => {
    const r = withTrainer('stf_other', ['stf_isil'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('trainer_not_allowed')
  })
  it('refuses a session with NO trainer when a whitelist is set', () => {
    const r = withTrainer(null, ['stf_isil'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('trainer_not_allowed')
  })
  it('a null whitelist allows any trainer', () => {
    expect(withTrainer('stf_anyone', null).ok).toBe(true)
  })
})

describe('isOverrideActiveAt — validity window (Phase 4, auto-return to package)', () => {
  it('is active with no window', () => {
    expect(isOverrideActiveAt({}, 1_000)).toBe(true)
  })
  it('is inactive before it starts and after it ends', () => {
    expect(isOverrideActiveAt({ effectiveFrom: 500, effectiveUntil: 1_500 }, 400)).toBe(false)
    expect(isOverrideActiveAt({ effectiveFrom: 500, effectiveUntil: 1_500 }, 1_600)).toBe(false)
  })
  it('is active inside the window', () => {
    expect(isOverrideActiveAt({ effectiveFrom: 500, effectiveUntil: 1_500 }, 1_000)).toBe(true)
  })
})
