import { describe, expect, it } from 'vitest'

import { decideJoin, decideLeave, decidePromote, type DecideContext } from './decide'
import { byQueueOrder, type WaitlistEntry } from './types'
import type { ClassSession } from '../../scheduling'
import type { MemberSnapshot } from '../../members'
import {
  instant,
  type BranchId,
  type ClassSessionId,
  type CorrelationId,
  type MemberId,
  type ReservationId,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'

const NOW = instant(1_000_000_000_000)
const H = 3_600_000

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const SNAP: MemberSnapshot = {
  memberId: 'mem_1' as MemberId,
  displayName: 'Ayşe Y.',
  phoneLast4: '4567',
  membershipStatus: 'active',
}

const full = (over: Partial<ClassSession> = {}): ClassSession => ({
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
  policySnapshot: {
    maxDaysInAdvance: 14,
    cancellationWindowHours: 6,
    cancellationWindowSource: 'service',
    lateCancellationConsumesCredit: true,
    noShowConsumesCredit: false,
    attendanceDefaultOutcome: 'attended',
    autoResolveAfterMinutes: 15,
    allowMemberSelfBooking: false,
  },
  bookedCount: 8, // full — that is the only time waiting means anything
  attendedCount: 0,
  serviceName: 'Reformer',
  roomName: 'A',
  trainerName: null,
  branchName: 'Merkez',
  ...over,
})

const join = (session = full(), booked = false, waiting = false) =>
  decideJoin(ctx, session, { entryId: 'wlt_1', memberId: 'mem_1' as MemberId, memberSnapshot: SNAP, queueLength: 2 }, booked, waiting)

const entry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
  id: 'wlt_1',
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  classSessionId: 'cls_1' as ClassSessionId,
  memberId: 'mem_1' as MemberId,
  memberSnapshot: SNAP,
  status: 'waiting',
  joinedAt: instant(NOW - 90 * 60_000),
  joinedBy: ctx.actor,
  resolvedAt: null,
  reservationId: null,
  ...over,
})

describe('waitlist (D20)', () => {
  it('joins a full future class, at the back of the queue, holding NO credit (I-29)', () => {
    const r = join()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.entry.status).toBe('waiting')
    expect(r.value.events).toHaveLength(1)
    expect(r.value.events[0]?.type).toBe('waitlist.joined')
    expect(r.value.events[0]?.payload).toMatchObject({ position: 3, creditEffect: 'none' })
  })

  const refusals: readonly [string, ReturnType<typeof join>, string][] = [
    ['a class with free seats', join(full({ bookedCount: 3 })), 'waitlist_not_open'],
    ['a cancelled class', join(full({ status: 'cancelled' })), 'waitlist_not_open'],
    ['a class in the past', join(full({ startsAt: instant(NOW - H) })), 'waitlist_not_open'],
    ['a member who already booked it', join(full(), true, false), 'already_booked'],
    ['a member already in the queue', join(full(), false, true), 'already_waitlisted'],
  ]
  it.each(refusals)('refuses %s', (_l, result, code) => {
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(code)
  })

  it('leaving records who left and why', () => {
    const r = decideLeave(ctx, entry(), 'staff')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.entry.status).toBe('left')
    expect(r.value.events[0]?.payload).toMatchObject({ reason: 'staff' })
  })

  it('a started class expires the queue, it does not "leave" it', () => {
    const r = decideLeave(ctx, entry(), 'session_started')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.entry.status).toBe('expired')
  })

  it('promotion records the reservation and how long she waited', () => {
    const r = decidePromote(ctx, entry(), 'res_9' as ReservationId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.entry.status).toBe('promoted')
    expect(r.value.entry.reservationId).toBe('res_9')
    expect(r.value.events[0]?.payload).toMatchObject({ reservationId: 'res_9', waitedMinutes: 90 })
  })

  it('refuses to promote or leave an entry that is no longer waiting', () => {
    expect(decidePromote(ctx, entry({ status: 'left' }), 'res_9' as ReservationId).ok).toBe(false)
    expect(decideLeave(ctx, entry({ status: 'promoted' }), 'staff').ok).toBe(false)
  })

  it('FIFO: the earliest join wins, and a same-millisecond tie breaks deterministically', () => {
    const a = entry({ id: 'wlt_b', joinedAt: NOW })
    const b = entry({ id: 'wlt_a', joinedAt: NOW })
    const c = entry({ id: 'wlt_c', joinedAt: instant(NOW - 1000) })
    expect([a, b, c].sort(byQueueOrder).map((e) => e.id)).toEqual(['wlt_c', 'wlt_a', 'wlt_b'])
  })
})
