import { describe, expect, it } from 'vitest'

import {
  instant,
  type BranchId,
  type ClassSessionId,
  type ClassTemplateId,
  type CorrelationId,
  type LocalDate,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import {
  decideCancelSession,
  decideChangeCapacity,
  decideChangeRoom,
  decideChangeTrainer,
  decideScheduleSession,
  decideUpdateTemplate,
} from './decide'
import type { DecideContext } from './decide'
import type { ClassSession, ClassTemplate, Room, SchedulingPolicy, Weekday } from './types'

// ctx.now is 1.7e12; edits require a not-yet-started session.
const FUTURE = instant(1_800_000_000_000)

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
  it('records from/to with a reason (future session)', () => {
    const r = decideChangeTrainer(ctx, makeSession({ startsAt: FUTURE }), 'usr_2' as StaffUserId, 'Vardiya değişimi')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toMatchObject({ from: null, to: 'usr_2' })
  })
  it('refuses an empty reason', () => {
    const r = decideChangeTrainer(ctx, makeSession({ startsAt: FUTURE }), null, '')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('reason_required')
  })
  it('refuses editing a session that has already started', () => {
    const r = decideChangeTrainer(ctx, makeSession({ startsAt: instant(1_000_000) }), null, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_not_editable')
  })
  it('refuses editing a cancelled session', () => {
    const r = decideChangeTrainer(ctx, makeSession({ startsAt: FUTURE, status: 'cancelled' }), null, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_not_editable')
  })
})

describe('decideChangeRoom (AD-48)', () => {
  const room2: Room = { ...room, id: 'rom_2' as RoomId, name: 'Salon B', capacity: 10 }
  it('changes the room on a future session', () => {
    const r = decideChangeRoom(ctx, makeSession({ startsAt: FUTURE }), room2, 'Salon bakımda')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toMatchObject({ fromRoomId: 'rom_1', toRoomId: 'rom_2' })
  })
  it('can clear the room (to null)', () => {
    const r = decideChangeRoom(ctx, makeSession({ startsAt: FUTURE }), null, 'Salon yok')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toMatchObject({ toRoomId: null })
  })
  it('refuses a room too small for the session capacity (AD-48)', () => {
    const small: Room = { ...room, id: 'rom_3' as RoomId, capacity: 4 }
    const r = decideChangeRoom(ctx, makeSession({ startsAt: FUTURE, capacity: 8 }), small, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_capacity_exceeds_room')
  })
  it('refuses a room in another branch', () => {
    const other: Room = { ...room, id: 'rom_4' as RoomId, branchId: 'brn_2' as BranchId }
    const r = decideChangeRoom(ctx, makeSession({ startsAt: FUTURE }), other, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('branch_mismatch')
  })
  it('refuses an inactive room', () => {
    const inactive: Room = { ...room, id: 'rom_5' as RoomId, active: false }
    const r = decideChangeRoom(ctx, makeSession({ startsAt: FUTURE }), inactive, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('room_not_active')
  })
  it('refuses editing a started session', () => {
    const r = decideChangeRoom(ctx, makeSession({ startsAt: instant(1_000_000) }), room2, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_not_editable')
  })
})

describe('decideChangeCapacity', () => {
  it('changes capacity on a future session', () => {
    const r = decideChangeCapacity(ctx, makeSession({ startsAt: FUTURE }), room, 6, 'Talep düştü')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toMatchObject({ fromCapacity: 8, toCapacity: 6 })
  })
  it('refuses dropping below the booked count', () => {
    const r = decideChangeCapacity(ctx, makeSession({ startsAt: FUTURE, bookedCount: 5 }), room, 4, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('capacity_below_booked')
  })
  it('refuses exceeding the room capacity (AD-48)', () => {
    const r = decideChangeCapacity(ctx, makeSession({ startsAt: FUTURE }), room, 9, 'x') // room capacity 8
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_capacity_exceeds_room')
  })
  it('is a no-op when capacity is unchanged', () => {
    const r = decideChangeCapacity(ctx, makeSession({ startsAt: FUTURE, capacity: 8 }), room, 8, 'x')
    expect(r.ok && r.value).toHaveLength(0)
  })
  it('refuses editing a started session', () => {
    const r = decideChangeCapacity(ctx, makeSession({ startsAt: instant(1_000_000) }), room, 6, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_not_editable')
  })
})

describe('decideUpdateTemplate', () => {
  const template: ClassTemplate = {
    id: 'tpl_1' as ClassTemplateId,
    studioId: 'std_1' as StudioId,
    branchId: 'brn_1' as BranchId,
    serviceId: 'svc_1' as ServiceId,
    roomId: 'rom_1' as RoomId,
    trainerId: null,
    dayOfWeek: 1 as Weekday,
    startTime: '10:00',
    durationMinutes: 60,
    capacity: 8,
    validFrom: '2026-01-01' as LocalDate,
    validUntil: '2026-12-31' as LocalDate,
    active: true,
  }
  it('records the changed fields with a reason', () => {
    const r = decideUpdateTemplate(ctx, template, { ...template, capacity: 10, startTime: '11:00' }, 'Güncelleme')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual({ changedFields: ['startTime', 'capacity'], reason: 'Güncelleme' })
  })
  it('is a no-op when nothing changed', () => {
    const r = decideUpdateTemplate(ctx, template, { ...template }, 'x')
    expect(r.ok && r.value).toHaveLength(0)
  })
  it('refuses an empty reason', () => {
    const r = decideUpdateTemplate(ctx, template, { ...template, capacity: 10 }, '')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('reason_required')
  })
})
