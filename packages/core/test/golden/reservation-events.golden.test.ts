import { describe, expect, it } from 'vitest'

import type { Entitlement } from '../../src/modules/entitlements'
import type { ClassSession, SessionPolicySnapshot } from '../../src/modules/scheduling'
import type { MemberSnapshot } from '../../src/modules/members'
import {
  decideAttendance,
  decideAutoResolution,
  decideBooking,
  decideCancellation,
  decideCorrection,
  decideSetReservationNote,
  type DecideContext,
} from '../../src/modules/reservations/domain/decide'
import type { Reservation } from '../../src/modules/reservations/domain/types'
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
} from '../../src/shared'
import attended from './reservation.attended.v1.json'
import autoResolved from './reservation.auto_resolved.v1.json'
import booked from './reservation.booked.v1.json'
import cancelled from './reservation.cancelled.v1.json'
import corrected from './reservation.corrected.v1.json'
import lateCancelled from './reservation.late_cancelled.v1.json'
import noShow from './reservation.no_show.v1.json'
import noteSet from './reservation.note_set.v1.json'

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
const pol: SessionPolicySnapshot = {
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  cancellationWindowSource: 'service' as const,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: false,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
  allowMemberSelfBooking: false,
}
const session = (startsAt = instant(NOW + 24 * H), over: Partial<ClassSession> = {}): ClassSession => ({
  id: 'cls_1' as ClassSessionId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  serviceId: 'svc_1' as ServiceId,
  roomId: 'rom_1' as RoomId,
  trainerId: null,
  templateId: null,
  assignedMemberId: null,
  category: 'pilates_group',
  startsAt,
  endsAt: instant(startsAt + H),
  capacity: 8,
  status: 'scheduled',
  cancellation: null,
  policyRef: { serviceId: 'svc_1' as ServiceId, version: 2 },
  policySnapshot: pol,
  bookedCount: 0,
  attendedCount: 0,
  serviceName: 'Reformer',
  roomName: 'A',
  trainerName: null,
  branchName: 'Merkez',
  ...over,
})
const held = (h: number): Entitlement => ({
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
  credits: { granted: 8, held: h, consumed: 0, restored: 0, revoked: 0, expired: 0 },
  freeze: null,
  priceAgreed: money(294_000),
  paidTotal: money(0),
  manualPayment: null,
  purchasedAt: instant(NOW - D),
})
const SNAP: MemberSnapshot = { memberId: 'mem_1' as MemberId, displayName: 'Ayşe Y.', phoneLast4: '4567', membershipStatus: 'active' }
const res = (over: Partial<Reservation> = {}): Reservation => ({
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
})

const payload = <T extends { ok: boolean }>(r: T): unknown => {
  if (!r.ok) throw new Error('expected ok')
  return (r as { value: { events: readonly { payload: unknown }[] } }).value.events[0]?.payload
}

describe('reservation event payloads match golden fixtures (AD-33)', () => {
  it('reservation.booked', () => {
    const r = decideBooking(ctx, session(), held(0), { reservationId: 'res_1' as ReservationId, memberId: 'mem_1' as MemberId, memberSnapshot: SNAP }, false)
    expect(payload(r)).toEqual(booked)
  })
  it('reservation.cancelled', () => {
    expect(payload(decideCancellation(ctx, res(), session()))).toEqual(cancelled)
  })
  it('reservation.late_cancelled', () => {
    expect(payload(decideCancellation(ctx, res(), session(instant(NOW + 3 * H))))).toEqual(lateCancelled)
  })
  it('reservation.attended', () => {
    expect(payload(decideAttendance(ctx, res(), session(instant(NOW - H)), 'attended'))).toEqual(attended)
  })
  it('reservation.no_show', () => {
    expect(payload(decideAttendance(ctx, res(), session(), 'no_show'))).toEqual(noShow)
  })
  it('reservation.auto_resolved', () => {
    // The session must have ended and passed its grace window for the sweep to fire.
    expect(payload(decideAutoResolution(ctx, res(), session(instant(NOW - 2 * H)), held(1)))).toEqual(autoResolved)
  })
  it('reservation.corrected', () => {
    expect(payload(decideCorrection(ctx, res({ status: 'no_show' }), 'attended', 'trainer marked wrong roster'))).toEqual(corrected)
  })
  it('reservation.note_set', () => {
    const r = decideSetReservationNote(ctx, res(), "Dizini incitmiş; reformer'da ağırlık düşük tutulacak.")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(noteSet)
  })
})
