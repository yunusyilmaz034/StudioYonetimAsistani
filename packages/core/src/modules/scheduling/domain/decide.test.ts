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
import { decideCancelSession, decideChangeTrainer, decideScheduleSession } from './decide'
import type { DecideContext } from './decide'
import type { ClassSession, Room, SchedulingPolicy } from './types'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const policy: SchedulingPolicy = {
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
}

const room: Room = {
  id: 'rom_1' as RoomId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  name: 'Salon A',
  capacity: 8,
  active: true,
}

function makeSession(o: Partial<ClassSession> = {}): ClassSession {
  return {
    id: 'cls_1' as ClassSessionId,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    serviceId: 'svc_1' as ServiceId,
    roomId: 'rom_1' as RoomId,
    trainerId: null,
    templateId: null,
    category: 'pilates_group',
    startsAt: instant(1_000_000),
    endsAt: instant(1_000_000 + 3_600_000),
    capacity: 8,
    status: 'scheduled',
    cancellation: null,
    policyRef: { serviceId: 'svc_1' as ServiceId, version: 2 },
    policySnapshot: policy,
    bookedCount: 0,
    attendedCount: 0,
    serviceName: 'Reformer',
    roomName: 'Salon A',
    trainerName: null,
    branchName: 'Merkez',
    ...o,
  }
}

describe('decideScheduleSession', () => {
  it('schedules when capacity fits the room, branch matches, time is valid (I-23, I-24)', () => {
    const r = decideScheduleSession(ctx, makeSession(), room)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value[0]?.type).toBe('class_session.scheduled')
      expect(r.value[0]?.payload).toMatchObject({ policyVersion: 2, category: 'pilates_group' })
    }
  })

  it('refuses capacity above the room (I-23)', () => {
    const r = decideScheduleSession(ctx, makeSession({ capacity: 9 }), room)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_capacity_exceeds_room')
  })

  it('refuses a room in another branch (I-23)', () => {
    const r = decideScheduleSession(ctx, makeSession({ branchId: 'brn_2' as BranchId }), room)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('branch_mismatch')
  })

  it('refuses a non-positive duration', () => {
    const r = decideScheduleSession(ctx, makeSession({ endsAt: instant(500_000) }), room)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_time_range')
  })

  it('allows a session with no room', () => {
    expect(decideScheduleSession(ctx, makeSession({ roomId: null, capacity: 100 }), null).ok).toBe(true)
  })
})

describe('decideCancelSession', () => {
  it('cancels with a reason', () => {
    const r = decideCancelSession(ctx, makeSession(), 'Eğitmen hasta')
    expect(r.ok && r.value[0]?.type).toBe('class_session.cancelled')
  })
  it('refuses an empty reason (AD-22)', () => {
    const r = decideCancelSession(ctx, makeSession(), '  ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('reason_required')
  })
  it('is idempotent on an already-cancelled session', () => {
    const r = decideCancelSession(ctx, makeSession({ status: 'cancelled' }), 'x')
    expect(r.ok && r.value).toHaveLength(0)
  })
})

describe('decideChangeTrainer', () => {
  it('records from/to with a reason', () => {
    const r = decideChangeTrainer(ctx, makeSession(), 'usr_2' as StaffUserId, 'Vardiya değişimi')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toMatchObject({ from: null, to: 'usr_2' })
  })
  it('refuses an empty reason', () => {
    const r = decideChangeTrainer(ctx, makeSession(), null, '')
    expect(r.ok).toBe(false)
  })
})
