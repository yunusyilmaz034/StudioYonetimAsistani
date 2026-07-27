import { describe, expect, it } from 'vitest'

import {
  instant,
  type BranchId,
  type ClassSessionId,
  type CorrelationId,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import { decideHoldSeat, decideReleaseSeat, type DecideContext } from './decide'
import { occupiedSeats, type ClassSession, type SeatHold, type SessionPolicySnapshot } from './types'

// Holding a seat for a non-member (owner, 2026-07-27). The rules that matter are the ones that stop
// a seat being promised twice, and the one that stops a hold nobody can explain.

const NOW = instant(1_000_000_000_000)
const H = 3_600_000

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const policy: SessionPolicySnapshot = {
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  cancellationWindowSource: 'service',
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: false,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
  allowMemberSelfBooking: false,
}

const session = (over: Partial<ClassSession> = {}): ClassSession =>
  ({
    id: 'cls_1' as ClassSessionId,
    studioId: 'std_1' as StudioId,
    branchId: 'br_1' as BranchId,
    serviceId: 'svc_1' as ServiceId,
    roomId: 'room_1' as RoomId,
    trainerId: null,
    templateId: null,
    category: 'pilates_group',
    assignedMemberId: null,
    startsAt: instant(NOW + H),
    endsAt: instant(NOW + 2 * H),
    capacity: 8,
    status: 'scheduled',
    cancellation: null,
    policyRef: { serviceId: 'svc_1' as ServiceId, version: 1 },
    policySnapshot: policy,
    bookedCount: 5,
    attendedCount: 0,
    serviceName: 'Reformer Pilates',
    roomName: 'Salon 1',
    trainerName: null,
    branchName: 'Mutlukent',
    ...over,
  }) as ClassSession

const held = (over: Partial<SeatHold> = {}): SeatHold =>
  ({
    id: 'hold_1',
    studioId: 'std_1' as StudioId,
    branchId: 'br_1' as BranchId,
    classSessionId: 'cls_1' as ClassSessionId,
    note: 'Multisport — Zeynep',
    cardNumber: null,
    status: 'held',
    sessionStartsAt: instant(NOW + H),
    heldAt: NOW,
    heldBy: ctx.actor,
    releasedAt: null,
    releasedBy: null,
    ...over,
  }) as SeatHold

const input = { holdId: 'hold_1', note: 'Multisport — Zeynep', cardNumber: null }

describe('occupiedSeats', () => {
  // The whole point of the field: a capacity question that asks `bookedCount` alone is a seat sold
  // twice, and it would be asked in eight different files.
  it('counts booked and held seats together', () => {
    expect(occupiedSeats({ bookedCount: 5, heldCount: 2 })).toBe(7)
  })
  it('reads a session written before holds existed as zero held', () => {
    // `exactOptionalPropertyTypes` is on, so the ABSENT field is the real shape — not one set to
    // undefined. That is precisely the case: every session document written before today has no
    // `heldCount` at all.
    expect(occupiedSeats({ bookedCount: 5 })).toBe(5)
  })
})

describe('decideHoldSeat', () => {
  it('holds a seat and moves the counter', () => {
    const r = decideHoldSeat(ctx, session(), input)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.session.heldCount).toBe(1)
      expect(r.value.hold.note).toBe('Multisport — Zeynep')
      expect(r.value.events.map((e) => e.type)).toEqual(['class_session.seat_held'])
    }
  })

  // No PII in an event, ever (#6). The guest is a third party who never agreed to be in this log.
  it('puts NO name or card number in the event payload', () => {
    const r = decideHoldSeat(ctx, session(), { ...input, cardNumber: '1234-5678' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const payload = JSON.stringify(r.value.events[0]?.payload)
      expect(payload).not.toContain('Zeynep')
      expect(payload).not.toContain('1234-5678')
    }
  })

  it('REFUSES a hold with no note — an anonymous seat is one nobody can explain', () => {
    const r = decideHoldSeat(ctx, session(), { ...input, note: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('seat_hold_note_required')
  })

  it('REFUSES when the class is full by bookings alone', () => {
    const r = decideHoldSeat(ctx, session({ bookedCount: 8 }), input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('class_full')
  })

  // The one that would over-allocate: seats already HELD must count as taken, or reception can hold
  // the same last seat for three different guests.
  it('REFUSES when the remaining seats are already held', () => {
    const r = decideHoldSeat(ctx, session({ bookedCount: 6, heldCount: 2 }), input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('class_full')
  })

  it('allows exactly the last free seat, and refuses the one after it', () => {
    const last = decideHoldSeat(ctx, session({ bookedCount: 7, heldCount: 0 }), input)
    expect(last.ok).toBe(true)
    const past = decideHoldSeat(ctx, session({ bookedCount: 7, heldCount: 1 }), input)
    expect(past.ok).toBe(false)
  })

  it('REFUSES a cancelled class — it has no seats to give', () => {
    const r = decideHoldSeat(ctx, session({ status: 'cancelled' }), input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_not_editable')
  })

  it('keeps an optional card number on the hold, trimmed, or null when blank', () => {
    const withCard = decideHoldSeat(ctx, session(), { ...input, cardNumber: '  MS-9931  ' })
    expect(withCard.ok && withCard.value.hold.cardNumber).toBe('MS-9931')
    const blank = decideHoldSeat(ctx, session(), { ...input, cardNumber: '   ' })
    expect(blank.ok && blank.value.hold.cardNumber).toBe(null)
  })
})

describe('decideReleaseSeat', () => {
  it('releases the seat and gives the counter back', () => {
    const r = decideReleaseSeat(ctx, session({ heldCount: 2 }), held())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.session.heldCount).toBe(1)
      expect(r.value.hold.status).toBe('released')
      expect(r.value.hold.releasedAt).toBe(NOW)
      expect(r.value.events.map((e) => e.type)).toEqual(['class_session.seat_released'])
    }
  })

  it('REFUSES to release a hold that is already released', () => {
    const r = decideReleaseSeat(ctx, session({ heldCount: 1 }), held({ status: 'released' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('seat_hold_not_open')
  })

  // A counter that can go negative makes a session look emptier than it is, and the next booking
  // over-fills the room. Floored, so a repaired inconsistency cannot become a worse one.
  it('never drives the counter below zero', () => {
    const r = decideReleaseSeat(ctx, session({ heldCount: 0 }), held())
    expect(r.ok && r.value.session.heldCount).toBe(0)
  })
})
