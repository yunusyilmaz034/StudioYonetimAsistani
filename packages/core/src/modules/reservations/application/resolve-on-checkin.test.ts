import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type ClassSessionId, type EntitlementId, type MemberId, type ReservationId, type StudioId } from '../../../shared'
import type { MemberSnapshot } from '../../members'
import type { Reservation, ReservationStatus } from '../domain/types'
import { nearestBookedReservation } from './resolve-on-checkin'

// WHICH reservation a door scan speaks for. This is the choice that decides whose credit moves, so
// it is pure and tested on its own — a member with two bookings in a day must not lose both to one
// scan, and a scan hours from any class must not resolve anything at all.

const NOW = instant(1_000_000_000_000)
const H = 3_600_000
const ARRIVE = 45

const snapshot: MemberSnapshot = {
  memberId: 'mem_1' as MemberId,
  displayName: 'Ayşe Y.',
  phoneLast4: '4321',
  membershipStatus: 'active',
}

const res = (over: Partial<Reservation> & { id: ReservationId; startsAt: number }): Reservation =>
  ({
    id: over.id,
    studioId: 'std_1' as StudioId,
    branchId: 'br_1' as BranchId,
    classSessionId: 'cls_1' as ClassSessionId,
    memberId: 'mem_1' as MemberId,
    entitlementId: 'ent_1' as EntitlementId,
    status: (over.status ?? 'booked') as ReservationStatus,
    creditEffect: 'held',
    sessionStartsAt: instant(over.startsAt),
    sessionEndsAt: instant(over.startsAt + H),
    sessionCategory: 'pilates_group',
    memberSnapshot: snapshot,
    bookedAt: NOW,
    bookedBy: { type: 'receptionist', id: 'usr_1' } as Reservation['bookedBy'],
    resolvedAt: null,
    resolvedBy: null,
    attendanceSource: null,
    policyRef: { policyId: 'pol_1', version: 1 },
  }) as Reservation

describe('nearestBookedReservation', () => {
  it('picks the class closest to the scan', () => {
    const morning = res({ id: 'r_morning' as ReservationId, startsAt: NOW - 20 * 60_000 })
    const later = res({ id: 'r_later' as ReservationId, startsAt: NOW + 40 * 60_000 })
    expect(nearestBookedReservation([later, morning], NOW, ARRIVE)?.id).toBe('r_morning')
  })

  // One arrival is evidence of ONE class. Claiming both would be inventing the second.
  it('never returns more than the single nearest, even with two bookings in range', () => {
    const a = res({ id: 'r_a' as ReservationId, startsAt: NOW })
    const b = res({ id: 'r_b' as ReservationId, startsAt: NOW + 30 * 60_000 })
    expect(nearestBookedReservation([a, b], NOW, ARRIVE)?.id).toBe('r_a')
  })

  it('returns nothing when every class is far from the scan', () => {
    const evening = res({ id: 'r_evening' as ReservationId, startsAt: NOW + 8 * H })
    expect(nearestBookedReservation([evening], NOW, ARRIVE)).toBeNull()
  })

  it('ignores reservations that are not open', () => {
    const cancelled = res({ id: 'r_x' as ReservationId, startsAt: NOW, status: 'cancelled' })
    const already = res({ id: 'r_y' as ReservationId, startsAt: NOW, status: 'attended' })
    expect(nearestBookedReservation([cancelled, already], NOW, ARRIVE)).toBeNull()
  })

  it('returns nothing when she has no bookings at all', () => {
    expect(nearestBookedReservation([], NOW, ARRIVE)).toBeNull()
  })
})
