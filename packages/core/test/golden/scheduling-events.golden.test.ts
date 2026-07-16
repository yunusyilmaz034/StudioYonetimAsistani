import { describe, expect, it } from 'vitest'

import { upcastClassSessionScheduled } from '../../src/modules/scheduling/upcasters'
import {
  decideAssignSessionMember,
  decideCancelSession,
  decideChangeCapacity,
  decideChangeRoom,
  decideReschedule,
  decideCreateService,
  decideScheduleSession,
  decideSetSessionNote,
  decideUpdateTemplate,
} from '../../src/modules/scheduling/domain/decide'
import type { DecideContext } from '../../src/modules/scheduling/domain/decide'
import type {
  ClassSession,
  ClassTemplate,
  Room,
  SessionPolicySnapshot,
  Service,
  Weekday,
} from '../../src/modules/scheduling/domain/types'
import {
  instant,
  type BranchId,
  type ClassSessionId,
  type ClassTemplateId,
  type CorrelationId,
  type LocalDate,
  type MemberId,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import serviceCreated from './service.created.v1.json'
import sessionCancelled from './class_session.cancelled.v1.json'
import sessionScheduledV1 from './class_session.scheduled.v1.json'
import sessionScheduledV2 from './class_session.scheduled.v2.json'
import sessionScheduledV3 from './class_session.scheduled.v3.json'
import roomChanged from './class_session.room_changed.v1.json'
import rescheduled from './class_session.rescheduled.v1.json'
import capacityChanged from './class_session.capacity_changed.v1.json'
import noteSet from './class_session.note_set.v1.json'
import templateUpdated from './class_template.updated.v1.json'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const policy: SessionPolicySnapshot = {
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  cancellationWindowSource: 'service' as const,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
  allowMemberSelfBooking: false,
}
const service: Service = {
  id: 'svc_1' as ServiceId,
  studioId: 'std_1' as StudioId,
  name: 'Reformer',
  category: 'pilates_group',
  policy,
  policyVersion: 1,
  active: true,
}
const session: ClassSession = {
  id: 'cls_1' as ClassSessionId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  serviceId: 'svc_1' as ServiceId,
  roomId: 'rom_1' as RoomId,
  trainerId: null,
  templateId: null,
  category: 'pilates_group',
  startsAt: instant(1_000_000),
  endsAt: instant(4_600_000),
  capacity: 8,
  assignedMemberId: null,
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
}

// AG-1 — `decideScheduleSession` now answers to the studio's opening hours. A golden fixture is about
// the event's PAYLOAD, so it runs with none configured. The payloads are unchanged: this is a
// signature change, not an event-schema change, and these fixtures are what prove it.
const NO_HOURS = { hours: null, utcOffsetMinutes: 180, specialWorkingDates: new Set<LocalDate>() }

describe('scheduling event payloads match golden fixtures (AD-33)', () => {
  it('service.created', () => {
    expect(decideCreateService(ctx, service)[0]?.payload).toEqual(serviceCreated)
  })
  it('class_session.scheduled (v3 — assignedMemberId + the effective window and its source)', () => {
    const r = decideScheduleSession(ctx, session, null, NO_HOURS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value[0]?.payload).toEqual(sessionScheduledV3)
      expect(r.value[0]?.version).toBe(3)
    }
  })
  it('v1 upcasts to v3 — "unassigned" is a FACT about v1; the window is "not recorded"', () => {
    // An upcaster may only supply what the old shape MEANT. v1 had no assignment (it was studio
    // inventory → null, a fact) and did not record the window (→ null, meaning *not recorded*,
    // NOT "no window"). Deriving the window from today's settings would be a lie: those settings
    // may have changed since. The session DOCUMENT still holds the real number.
    expect(upcastClassSessionScheduled(sessionScheduledV1, 1)).toEqual({
      ...sessionScheduledV3,
      cancellationWindowHours: null,
      cancellationWindowSource: null,
    })
  })
  it('v2 upcasts to v3 — the assignment survives, the window stays "not recorded"', () => {
    expect(upcastClassSessionScheduled(sessionScheduledV2, 2)).toEqual({
      ...sessionScheduledV3,
      cancellationWindowHours: null,
      cancellationWindowSource: null,
    })
  })
  it('upcasting a v3 event is the identity', () => {
    expect(upcastClassSessionScheduled(sessionScheduledV3, 3)).toEqual(sessionScheduledV3)
  })
  it('class_session.assigned', () => {
    const r = decideAssignSessionMember(
      ctx,
      { ...session, category: 'private', assignedMemberId: null, startsAt: instant(1_800_000_000_000) },
      'mem_1' as MemberId,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual({ from: null, to: 'mem_1' })
  })
  it('class_session.cancelled', () => {
    const r = decideCancelSession(ctx, session, 'Eğitmen hasta')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(sessionCancelled)
  })

  // Session edits require a not-yet-started session (startsAt > ctx.now).
  const futureSession: ClassSession = { ...session, startsAt: instant(1_800_000_000_000), endsAt: instant(1_800_003_600_000) }
  const room2: Room = { id: 'rom_2' as RoomId, studioId: 'std_1' as StudioId, branchId: 'brn_1' as BranchId, name: 'Salon B', capacity: 10, active: true }

  it('class_session.room_changed', () => {
    const r = decideChangeRoom(ctx, futureSession, room2, 'Salon bakımda')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(roomChanged)
  })

  it('class_session.rescheduled', () => {
    const r = decideReschedule(
      ctx,
      futureSession,
      instant(1_800_007_200_000),
      instant(1_800_010_800_000),
      NO_HOURS,
      'Salon çakışması',
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(rescheduled)
  })

  // Reschedule refusals — the new time obeys the same guards as creation.
  it('reschedule refuses a session that already started', () => {
    // `session` starts at 1_000_000, long before ctx.now (1_700_000_000_000).
    const r = decideReschedule(ctx, session, instant(1_800_007_200_000), instant(1_800_010_800_000), NO_HOURS, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_not_editable')
  })
  it('reschedule refuses an end at or before the start', () => {
    const r = decideReschedule(ctx, futureSession, instant(1_800_010_800_000), instant(1_800_007_200_000), NO_HOURS, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_time_range')
  })
  it('reschedule refuses an empty reason (a correction is never anonymous)', () => {
    const r = decideReschedule(ctx, futureSession, instant(1_800_007_200_000), instant(1_800_010_800_000), NO_HOURS, '  ')
    expect(r.ok).toBe(false)
  })
  it('reschedule to the same time writes nothing (no-op)', () => {
    const r = decideReschedule(ctx, futureSession, futureSession.startsAt, futureSession.endsAt, NO_HOURS, 'x')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.length).toBe(0)
  })
  it('class_session.capacity_changed', () => {
    const r = decideChangeCapacity(ctx, futureSession, room2, 10, 'Talep arttı')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(capacityChanged)
  })
  it('class_session.note_set', () => {
    const r = decideSetSessionNote(ctx, futureSession, {
      text: 'Reformer yayları bugün değişti; ilk 10 dakika ısınmaya ayrılacak.',
      visibility: 'members',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(noteSet)
  })
  it('class_template.updated', () => {
    const current: ClassTemplate = {
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
    const r = decideUpdateTemplate(ctx, current, { ...current, capacity: 10 }, 'Kapasite güncellendi')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual(templateUpdated)
  })
})
