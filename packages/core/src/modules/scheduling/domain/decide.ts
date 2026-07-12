import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type BranchId,
  type Category,
  type CorrelationId,
  type DomainError,
  type EventRelated,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type Result,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import {
  CLASS_SESSION_ASSIGNED,
  CLASS_SESSION_CANCELLED,
  CLASS_SESSION_CAPACITY_CHANGED,
  CLASS_SESSION_NOTE_SET,
  CLASS_SESSION_ROOM_CHANGED,
  CLASS_SESSION_SCHEDULED,
  CLASS_SESSION_SCHEDULED_VERSION,
  STUDIO_SETTINGS_UPDATED,
  CLASS_SESSION_TRAINER_CHANGED,
  CLASS_TEMPLATE_CREATED,
  CLASS_TEMPLATE_DEACTIVATED,
  CLASS_TEMPLATE_UPDATED,
  ROOM_CREATED,
  ROOM_DEACTIVATED,
  ROOM_REACTIVATED,
  ROOM_UPDATED,
  SERVICE_CREATED,
  SERVICE_DEACTIVATED,
  SERVICE_POLICY_PUBLISHED,
  SERVICE_REACTIVATED,
  SERVICE_UPDATED,
} from '../events'
import type { ClassSession, ClassTemplate, NoteVisibility, Room, Service, StudioSettings } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(
  ctx: DecideContext,
  kind: AggregateKind,
  id: string,
  branchId: BranchId | null,
  related: EventRelated = {},
) {
  return {
    studioId: ctx.studioId,
    branchId,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind, id },
    related,
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// D13 — the PT capacity band. Ownership is independent of capacity (a reserved slot may be a
// partner PT), but a PRIVATE session may never seat more than two.
const PT_MAX_CAPACITY = 2
function ptCapacity_(category: Category, capacity: number): Result<never, DomainError> | null {
  return category === 'private' && capacity > PT_MAX_CAPACITY
    ? err({ code: 'pt_capacity_exceeded', maxCapacity: PT_MAX_CAPACITY, capacity })
    : null
}

function reason_(reason: string): Result<never, DomainError> | null {
  return reason.trim().length === 0 ? err({ code: 'reason_required' }) : null
}

// A binding business rule (v1.12): a session that has STARTED or is no longer
// `scheduled` may never be edited — trainer, room, and capacity changes apply only to
// not-yet-started future sessions. This keeps the event history, attendance, and
// (later) financial records consistent with what the session actually was. Pure: the
// clock is `ctx.now`, injected. Cancellation is a separate act, not an edit.
function editable_(ctx: DecideContext, session: ClassSession): Result<never, DomainError> | null {
  return session.status !== 'scheduled' || session.startsAt <= ctx.now
    ? err({ code: 'session_not_editable' })
    : null
}

// ── Service ──
export function decideCreateService(ctx: DecideContext, s: Service): NewEvent[] {
  return [
    {
      ...base(ctx, 'service', s.id, null),
      type: SERVICE_CREATED,
      payload: { name: s.name, category: s.category, policyVersion: s.policyVersion },
    },
  ]
}

export function decideUpdateService(ctx: DecideContext, current: Service, next: Service): NewEvent[] {
  const changedFields = current.name !== next.name ? ['name'] : []
  if (changedFields.length === 0) return []
  return [{ ...base(ctx, 'service', next.id, null), type: SERVICE_UPDATED, payload: { changedFields } }]
}

export function decidePublishServicePolicy(
  ctx: DecideContext,
  next: Service,
  changedFields: readonly string[],
): NewEvent[] {
  return [
    {
      ...base(ctx, 'service', next.id, null),
      type: SERVICE_POLICY_PUBLISHED,
      payload: { policyVersion: next.policyVersion, changedFields },
    },
  ]
}

export function decideDeactivateService(
  ctx: DecideContext,
  s: Service,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  return ok([{ ...base(ctx, 'service', s.id, null), type: SERVICE_DEACTIVATED, payload: { reason } }])
}

export function decideReactivateService(ctx: DecideContext, s: Service): NewEvent[] {
  return [{ ...base(ctx, 'service', s.id, null), type: SERVICE_REACTIVATED, payload: {} }]
}

// ── Room ──
export function decideCreateRoom(ctx: DecideContext, r: Room): NewEvent[] {
  return [
    {
      ...base(ctx, 'room', r.id, r.branchId),
      type: ROOM_CREATED,
      payload: { branchId: r.branchId, name: r.name, capacity: r.capacity },
    },
  ]
}

export function decideUpdateRoom(ctx: DecideContext, current: Room, next: Room): NewEvent[] {
  const changedFields: string[] = []
  if (current.name !== next.name) changedFields.push('name')
  if (current.capacity !== next.capacity) changedFields.push('capacity')
  if (changedFields.length === 0) return []
  return [{ ...base(ctx, 'room', next.id, next.branchId), type: ROOM_UPDATED, payload: { changedFields } }]
}

export function decideDeactivateRoom(
  ctx: DecideContext,
  r: Room,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  return ok([{ ...base(ctx, 'room', r.id, r.branchId), type: ROOM_DEACTIVATED, payload: { reason } }])
}

export function decideReactivateRoom(ctx: DecideContext, r: Room): NewEvent[] {
  return [{ ...base(ctx, 'room', r.id, r.branchId), type: ROOM_REACTIVATED, payload: {} }]
}

// ── ClassTemplate ──
export function decideCreateTemplate(ctx: DecideContext, t: ClassTemplate): NewEvent[] {
  return [
    {
      ...base(ctx, 'classTemplate', t.id, t.branchId, t.trainerId ? { trainerId: t.trainerId } : {}),
      type: CLASS_TEMPLATE_CREATED,
      payload: {
        serviceId: t.serviceId,
        branchId: t.branchId,
        roomId: t.roomId,
        trainerId: t.trainerId,
        dayOfWeek: t.dayOfWeek,
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
        capacity: t.capacity,
        validFrom: t.validFrom,
        validUntil: t.validUntil,
      },
    },
  ]
}

export function decideDeactivateTemplate(
  ctx: DecideContext,
  t: ClassTemplate,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  return ok([
    { ...base(ctx, 'classTemplate', t.id, t.branchId), type: CLASS_TEMPLATE_DEACTIVATED, payload: { reason } },
  ])
}

// Edit a template in place (AD-49 pattern). Only FUTURE generations change —
// already-generated sessions keep their snapshot (idempotent generation, AD-50).
// serviceId and branchId are not editable (a different service means a different
// template; create a new one). No "started" guard: a template is a recurring
// definition, not a dated session.
export function decideUpdateTemplate(
  ctx: DecideContext,
  current: ClassTemplate,
  next: ClassTemplate,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  const changedFields: string[] = []
  if (current.roomId !== next.roomId) changedFields.push('roomId')
  if (current.trainerId !== next.trainerId) changedFields.push('trainerId')
  if (current.dayOfWeek !== next.dayOfWeek) changedFields.push('dayOfWeek')
  if (current.startTime !== next.startTime) changedFields.push('startTime')
  if (current.durationMinutes !== next.durationMinutes) changedFields.push('durationMinutes')
  if (current.capacity !== next.capacity) changedFields.push('capacity')
  if (current.validFrom !== next.validFrom) changedFields.push('validFrom')
  if (current.validUntil !== next.validUntil) changedFields.push('validUntil')
  if (changedFields.length === 0) return ok([]) // no-op
  return ok([
    {
      ...base(ctx, 'classTemplate', next.id, next.branchId, next.trainerId ? { trainerId: next.trainerId } : {}),
      type: CLASS_TEMPLATE_UPDATED,
      payload: { changedFields, reason },
    },
  ])
}

// ── ClassSession ──
export function decideScheduleSession(
  ctx: DecideContext,
  session: ClassSession,
  room: Room | null,
): Result<NewEvent[], DomainError> {
  if (session.endsAt <= session.startsAt) return err({ code: 'invalid_time_range' })
  if (room) {
    if (room.branchId !== session.branchId) return err({ code: 'branch_mismatch' })
    if (session.capacity > room.capacity) {
      return err({
        code: 'session_capacity_exceeds_room',
        capacity: session.capacity,
        roomCapacity: room.capacity,
      })
    }
  }
  // D13 — a member may only be assigned to a PRIVATE session. Assigning one to a group class
  // would mean "this Reformer class belongs to Elif", which is not a thing.
  if (session.assignedMemberId !== null && session.category !== 'private') {
    return err({ code: 'assignment_requires_private_session' })
  }
  // D13 (owner, 2026-07-12) — PT is 1-on-1 (capacity 1) or partner PT (capacity 2). Three or
  // more is a group class wearing a PT label, and it would be sold, staffed and priced wrong.
  // The band is enforced HERE, not in the form: a rule that only exists in the UI is not a rule.
  const ptBand = ptCapacity_(session.category, session.capacity)
  if (ptBand) return ptBand
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, {
        classSessionId: session.id,
        ...(session.trainerId ? { trainerId: session.trainerId } : {}),
        ...(session.assignedMemberId ? { memberId: session.assignedMemberId } : {}),
      }),
      type: CLASS_SESSION_SCHEDULED,
      version: CLASS_SESSION_SCHEDULED_VERSION, // v2 — carries assignedMemberId (D13)
      payload: {
        serviceId: session.serviceId,
        branchId: session.branchId,
        roomId: session.roomId,
        trainerId: session.trainerId,
        assignedMemberId: session.assignedMemberId,
        category: session.category,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        capacity: session.capacity,
        policyVersion: session.policyRef.version,
        // D14 — the window this session is created under, and which level of the chain
        // answered. Recorded on the event so the log can explain itself later.
        cancellationWindowHours: session.policySnapshot.cancellationWindowHours,
        cancellationWindowSource: session.policySnapshot.cancellationWindowSource,
      },
    },
  ])
}

// D14 — the studio-level default cancellation window (level 3 of the chain). Changing it
// affects only sessions created AFTER it: every existing session already carries its own
// resolved, stamped window, and nothing here reaches back to rewrite them.
export function decideSetStudioDefaults(
  ctx: DecideContext,
  current: StudioSettings | null,
  defaultCancellationWindowHours: number | null,
): Result<NewEvent[], DomainError> {
  if (defaultCancellationWindowHours !== null && defaultCancellationWindowHours < 0) {
    return err({ code: 'invalid_time_range' })
  }
  const previous = current?.defaultCancellationWindowHours ?? null
  if (previous === defaultCancellationWindowHours) return ok([]) // idempotent
  return ok([
    {
      ...base(ctx, 'policy', ctx.studioId, null, {}),
      type: STUDIO_SETTINGS_UPDATED,
      payload: {
        defaultCancellationWindowHours,
        previousDefaultCancellationWindowHours: previous,
      },
    },
  ])
}

// D13 — assign a private session to a member, re-assign it, or release it back to studio
// inventory (`to: null`).
//
// Guarded by `bookedCount === 0`: once someone is booked into the slot, re-assigning it would
// silently leave a reservation belonging to a member who no longer owns the session. Cancel the
// reservation first — that is an explicit act, with its own event, and its own credit effect.
export function decideAssignSessionMember(
  ctx: DecideContext,
  session: ClassSession,
  to: MemberId | null,
): Result<NewEvent[], DomainError> {
  if (session.category !== 'private') return err({ code: 'assignment_requires_private_session' })
  if (session.status !== 'scheduled' || session.startsAt <= ctx.now) {
    return err({ code: 'session_not_editable' })
  }
  if (session.assignedMemberId === to) return ok([]) // idempotent
  if (session.bookedCount > 0) return err({ code: 'session_has_reservations' })
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, {
        classSessionId: session.id,
        ...(to ? { memberId: to } : {}),
      }),
      type: CLASS_SESSION_ASSIGNED,
      payload: { from: session.assignedMemberId, to },
    },
  ])
}

export function decideCancelSession(
  ctx: DecideContext,
  session: ClassSession,
  reason: string,
): Result<NewEvent[], DomainError> {
  const bad = reason_(reason)
  if (bad) return bad
  if (session.status === 'cancelled') return ok([]) // idempotent
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_CANCELLED,
      payload: { reason, startsAt: session.startsAt },
    },
  ])
}

export function decideChangeTrainer(
  ctx: DecideContext,
  session: ClassSession,
  to: StaffUserId | null,
  reason: string,
): Result<NewEvent[], DomainError> {
  const started = editable_(ctx, session)
  if (started) return started
  const bad = reason_(reason)
  if (bad) return bad
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, {
        classSessionId: session.id,
        ...(to ? { trainerId: to } : {}),
      }),
      type: CLASS_SESSION_TRAINER_CHANGED,
      payload: { from: session.trainerId, to, reason },
    },
  ])
}

// Change the session's room. AD-48: a room is branch-scoped and a session's capacity
// may not exceed its room's capacity. Clearing the room (to null) drops those checks.
export function decideChangeRoom(
  ctx: DecideContext,
  session: ClassSession,
  toRoom: Room | null,
  reason: string,
): Result<NewEvent[], DomainError> {
  const started = editable_(ctx, session)
  if (started) return started
  const bad = reason_(reason)
  if (bad) return bad
  if (toRoom) {
    if (!toRoom.active) return err({ code: 'room_not_active' })
    if (toRoom.branchId !== session.branchId) return err({ code: 'branch_mismatch' })
    if (session.capacity > toRoom.capacity) {
      return err({
        code: 'session_capacity_exceeds_room',
        capacity: session.capacity,
        roomCapacity: toRoom.capacity,
      })
    }
  }
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_ROOM_CHANGED,
      payload: { fromRoomId: session.roomId, toRoomId: toRoom ? toRoom.id : null, reason },
    },
  ])
}

// Change the session's capacity. It may never drop below what is already booked (a
// booked member is never stranded), and may not exceed the room (AD-48).
export function decideChangeCapacity(
  ctx: DecideContext,
  session: ClassSession,
  room: Room | null,
  toCapacity: number,
  reason: string,
): Result<NewEvent[], DomainError> {
  const started = editable_(ctx, session)
  if (started) return started
  const bad = reason_(reason)
  if (bad) return bad
  const ptBand = ptCapacity_(session.category, toCapacity)
  if (ptBand) return ptBand
  if (toCapacity < session.bookedCount) {
    return err({ code: 'capacity_below_booked', bookedCount: session.bookedCount })
  }
  if (room && toCapacity > room.capacity) {
    return err({ code: 'session_capacity_exceeds_room', capacity: toCapacity, roomCapacity: room.capacity })
  }
  if (toCapacity === session.capacity) return ok([]) // no-op
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_CAPACITY_CHANGED,
      payload: { fromCapacity: session.capacity, toCapacity, reason },
    },
  ])
}

// Set (or clear) the class note (Ders Notu). Free text is preserved intact — trimmed
// only at the edges. Unlike trainer/room/capacity edits, a note is metadata, not a
// schedule change, so it is allowed on any non-cancelled session (you may note a class
// that has already happened). Empty text clears the note. No `reason` required.
export function decideSetSessionNote(
  ctx: DecideContext,
  session: ClassSession,
  input: { text: string; visibility: NoteVisibility },
): Result<NewEvent[], DomainError> {
  if (session.status === 'cancelled') return err({ code: 'session_not_editable' })
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, { classSessionId: session.id }),
      type: CLASS_SESSION_NOTE_SET,
      payload: { text: input.text.trim(), visibility: input.visibility },
    },
  ])
}
