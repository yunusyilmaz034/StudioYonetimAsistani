import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type BranchId,
  type CorrelationId,
  type DomainError,
  type EventRelated,
  type EventSource,
  type Instant,
  type NewEvent,
  type Result,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import {
  CLASS_SESSION_CANCELLED,
  CLASS_SESSION_SCHEDULED,
  CLASS_SESSION_TRAINER_CHANGED,
  CLASS_TEMPLATE_CREATED,
  CLASS_TEMPLATE_DEACTIVATED,
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
import type { ClassSession, ClassTemplate, Room, Service } from './types'

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

function reason_(reason: string): Result<never, DomainError> | null {
  return reason.trim().length === 0 ? err({ code: 'reason_required' }) : null
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
  return ok([
    {
      ...base(ctx, 'classSession', session.id, session.branchId, {
        classSessionId: session.id,
        ...(session.trainerId ? { trainerId: session.trainerId } : {}),
      }),
      type: CLASS_SESSION_SCHEDULED,
      payload: {
        serviceId: session.serviceId,
        branchId: session.branchId,
        roomId: session.roomId,
        trainerId: session.trainerId,
        category: session.category,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        capacity: session.capacity,
        policyVersion: session.policyRef.version,
      },
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
