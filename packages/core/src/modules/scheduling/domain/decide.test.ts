import { describe, expect, it } from 'vitest'

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
} from '../../../shared'
import {
  decideAssignSessionMember,
  decideCancelSession,
  decideChangeCapacity,
  decideChangeRoom,
  decideChangeTrainer,
  decideScheduleSession,
  decideSetSessionNote,
  decideUpdateTemplate,
} from './decide'
import type { DecideContext } from './decide'
import type { ClassSession, ClassTemplate, Room, SessionPolicySnapshot, Weekday } from './types'

// ctx.now is 1.7e12; edits require a not-yet-started session.
const FUTURE = instant(1_800_000_000_000)

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
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
    assignedMemberId: null,
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

describe('decideSetSessionNote', () => {
  it('emits note_set with the trimmed text and visibility', () => {
    const r = decideSetSessionNote(ctx, makeSession({ startsAt: FUTURE }), { text: '  Yaylar değişti  ', visibility: 'members' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual({ text: 'Yaylar değişti', visibility: 'members' })
  })
  it('is allowed on a started or completed session (a note is metadata, not an edit)', () => {
    const r = decideSetSessionNote(ctx, makeSession({ startsAt: instant(1_000_000), status: 'completed' }), { text: 'Ders iyi geçti', visibility: 'staff' })
    expect(r.ok).toBe(true)
  })
  it('allows clearing (empty text)', () => {
    const r = decideSetSessionNote(ctx, makeSession({ startsAt: FUTURE }), { text: '   ', visibility: 'staff' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual({ text: '', visibility: 'staff' })
  })
  it('refuses a note on a cancelled session', () => {
    const r = decideSetSessionNote(ctx, makeSession({ status: 'cancelled' }), { text: 'x', visibility: 'staff' })
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

// ── D13 — PT ownership ────────────────────────────────────────────────────────
describe('decideAssignSessionMember (D13)', () => {
  const pt = (over: Partial<ClassSession> = {}) =>
    makeSession({ category: 'private', assignedMemberId: null, capacity: 1, startsAt: FUTURE, ...over })
  const MEM = 'mem_1' as MemberId

  it('assigns a private session to a member', () => {
    const r = decideAssignSessionMember(ctx, pt(), MEM)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value[0]?.type).toBe('class_session.assigned')
      expect(r.value[0]?.payload).toEqual({ from: null, to: MEM })
    }
  })

  it('releases an assigned session back to studio inventory (to: null)', () => {
    const r = decideAssignSessionMember(ctx, pt({ assignedMemberId: MEM }), null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toEqual({ from: MEM, to: null })
  })

  it('is idempotent — re-assigning the same member emits nothing', () => {
    const r = decideAssignSessionMember(ctx, pt({ assignedMemberId: MEM }), MEM)
    expect(r).toEqual({ ok: true, value: [] })
  })

  it('refuses to assign a member to a GROUP class', () => {
    const r = decideAssignSessionMember(ctx, makeSession({ category: 'pilates_group', startsAt: FUTURE }), MEM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('assignment_requires_private_session')
  })

  it('refuses to re-assign a slot that already has a reservation', () => {
    // Re-assigning would leave a booking belonging to a member who no longer owns the session.
    // Cancel the reservation first — that is an explicit act with its own credit effect.
    const r = decideAssignSessionMember(ctx, pt({ assignedMemberId: MEM, bookedCount: 1 }), 'mem_2' as MemberId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_has_reservations')
  })

  it('refuses to assign a session that has already started (I-26)', () => {
    const r = decideAssignSessionMember(ctx, pt({ startsAt: instant(1_000_000) }), MEM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('session_not_editable')
  })
})

// ── D13 — the PT capacity band (owner, 2026-07-12) ────────────────────────────
describe('PT capacity band (D13): 1 = one-on-one, 2 = partner, 3+ = a group class', () => {
  const bigRoom: Room = { ...room, capacity: 12 }

  it('creates a one-on-one PT (capacity 1)', () => {
    const r = decideScheduleSession(ctx, makeSession({ category: 'private', capacity: 1 }), bigRoom)
    expect(r.ok).toBe(true)
  })

  it('creates a PARTNER PT (capacity 2) — ownership is independent of capacity', () => {
    const r = decideScheduleSession(
      ctx,
      makeSession({ category: 'private', capacity: 2, assignedMemberId: 'mem_1' as MemberId }),
      bigRoom,
    )
    expect(r.ok).toBe(true)
  })

  it('refuses a PT with capacity 3 — that is a group class, not a PT', () => {
    const r = decideScheduleSession(ctx, makeSession({ category: 'private', capacity: 3 }), bigRoom)
    expect(r).toEqual({
      ok: false,
      error: { code: 'pt_capacity_exceeded', maxCapacity: 2, capacity: 3 },
    })
  })

  it('the band does not apply to group classes', () => {
    const r = decideScheduleSession(ctx, makeSession({ category: 'pilates_group', capacity: 8 }), bigRoom)
    expect(r.ok).toBe(true)
  })

  it('refuses RAISING a PT session past 2 later on — the rule is not only at creation', () => {
    const pt = makeSession({ category: 'private', capacity: 2, startsAt: FUTURE })
    const r = decideChangeCapacity(ctx, pt, bigRoom, 3, 'Partner ekleniyor')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('pt_capacity_exceeded')
  })

  it('allows changing a PT between 1 and 2', () => {
    const pt = makeSession({ category: 'private', capacity: 1, startsAt: FUTURE })
    const r = decideChangeCapacity(ctx, pt, bigRoom, 2, 'Partner PT oldu')
    expect(r.ok).toBe(true)
  })
})

// D13 — assignment AT CREATION (the owner's second business model).
describe('assignment at session creation (D13)', () => {
  it('creates a PT slot already reserved for a member', () => {
    const r = decideScheduleSession(
      ctx,
      makeSession({ category: 'private', capacity: 1, assignedMemberId: 'mem_1' as MemberId }),
      room,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value[0]?.payload).toMatchObject({ assignedMemberId: 'mem_1' })
      expect(r.value[0]?.related).toMatchObject({ memberId: 'mem_1' })
    }
  })

  it('creates an OPEN PT slot by default (assignedMemberId null)', () => {
    const r = decideScheduleSession(ctx, makeSession({ category: 'private', capacity: 1 }), room)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.payload).toMatchObject({ assignedMemberId: null })
  })

  it('refuses assigning a member to a GROUP class at creation', () => {
    const r = decideScheduleSession(
      ctx,
      makeSession({ category: 'pilates_group', assignedMemberId: 'mem_1' as MemberId }),
      room,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('assignment_requires_private_session')
  })
})
