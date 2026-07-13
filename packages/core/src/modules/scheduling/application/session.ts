import {
  newClassSessionId,
  type BranchId,
  type ClassSessionId,
  type ClassTemplateId,
  type DomainError,
  type Instant,
  type LocalDate,
  type MemberId,
  type NewEvent,
  type Result,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type TenantContext,
  type OperationId,
} from '../../../shared'
import {
  decideAssignSessionMember,
  decideCancelSession,
  decideChangeCapacity,
  decideChangeRoom,
  decideChangeTrainer,
  decideScheduleSession,
  decideSetSessionNote,
  decideUpdateStudioSettings,
} from '../domain/decide'
import { resolveCancellationWindow } from '../domain/cancellation-window'
import type {
  ClassSession,
  NoteVisibility,
  Room,
  Service,
  SessionPolicySnapshot,
  StudioSettings,
} from '../domain/types'
import { decideContext } from './service'
import type { SchedulingDeps } from './ports'
import {
  addDays,
  localDateOf,
  localSlotToInstant,
  maxDate,
  minDate,
  occurrenceDates,
} from './time-window'

// Build a scheduled ClassSession from a service + slot. Category (I-22) and the
// policy snapshot (I-24) are taken from the service; capacity/room from the caller.
function buildSession(params: {
  service: Service
  branchId: BranchId
  branchName: string
  room: Room | null
  trainerId: StaffUserId | null
  trainerName: string | null
  templateId: ClassTemplateId | null
  startsAt: Instant
  endsAt: Instant
  capacity: number
  assignedMemberId: MemberId | null
  policySnapshot: SessionPolicySnapshot
}): ClassSession {
  const { service, room } = params
  return {
    id: newClassSessionId(),
    studioId: service.studioId,
    branchId: params.branchId,
    serviceId: service.id,
    roomId: room ? room.id : null,
    trainerId: params.trainerId,
    templateId: params.templateId,
    category: service.category,
    assignedMemberId: params.assignedMemberId,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    capacity: params.capacity,
    status: 'scheduled',
    cancellation: null,
    policyRef: { serviceId: service.id, version: service.policyVersion },
    // D14 — the window is RESOLVED and stamped here (I-24). Nothing downstream re-derives it.
    policySnapshot: params.policySnapshot,
    bookedCount: 0,
    attendedCount: 0,
    serviceName: service.name,
    roomName: room ? room.name : null,
    trainerName: params.trainerName,
    branchName: params.branchName,
  }
}

// D14 — the chain, run once: session override → service → studio → (refuse). The system
// default (6 h) is DATA a studio is provisioned with, not a number in this code.
async function resolveSnapshot(
  deps: SchedulingDeps,
  ctx: TenantContext,
  service: Service,
  override: number | null,
): Promise<Result<SessionPolicySnapshot, DomainError>> {
  const studioSettings = await deps.repo.getStudioSettings(ctx)
  const resolved = resolveCancellationWindow({
    sessionOverride: override,
    servicePolicy: service.policy,
    studioSettings,
  })
  if (!resolved.ok) return resolved
  return {
    ok: true,
    value: {
      ...service.policy,
      cancellationWindowHours: resolved.value.hours,
      cancellationWindowSource: resolved.value.source,
    },
  }
}

export interface ScheduleSessionInput {
  readonly serviceId: ServiceId
  readonly branchId: BranchId
  readonly branchName: string
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly trainerName: string | null
  readonly date: string // 'YYYY-MM-DD' local
  readonly startTime: string // 'HH:MM' local
  readonly durationMinutes: number
  readonly capacity: number
  // D13 — only meaningful for a private session; null everywhere else.
  readonly assignedMemberId?: MemberId | null
  // D14 — level 1 of the chain: this session's own override. Omitted/null ⇒ inherit.
  readonly cancellationWindowHours?: number | null
}

export async function scheduleSession(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: ScheduleSessionInput,
): Promise<Result<{ sessionId: ClassSessionId }, DomainError>> {
  const service = await deps.repo.getService(ctx, input.serviceId)
  if (!service) throw new Error(`Service not found: ${input.serviceId}`)
  const room = input.roomId ? await deps.repo.getRoom(ctx, input.roomId) : null
  const { startsAt, endsAt } = localSlotToInstant(
    input.date as LocalDate,
    input.startTime,
    input.durationMinutes,
    deps.studioConfig,
  )
  // D14 — resolve the cancellation window ONCE, here, and stamp it. Never at read time.
  const snapshot = await resolveSnapshot(deps, ctx, service, input.cancellationWindowHours ?? null)
  if (!snapshot.ok) return snapshot
  const session = buildSession({
    service,
    branchId: input.branchId,
    branchName: input.branchName,
    room,
    trainerId: input.trainerId,
    trainerName: input.trainerName,
    templateId: null,
    startsAt,
    endsAt,
    capacity: input.capacity,
    assignedMemberId: input.assignedMemberId ?? null,
    policySnapshot: snapshot.value,
  })
  // AG-1 — the studio's hours are LOADED here and handed to the decider. One extra read on a path
  // that already reads the service, the room and the policy; the alternative is a rule that exists
  // only in the form, and a rule that only exists in the UI is not a rule.
  const events = decideScheduleSession(
    decideContext(deps, ctx),
    session,
    room,
    await deps.hours.getStudioHours(ctx),
  )
  if (!events.ok) return events
  await deps.repo.saveSession(ctx, session, events.value)
  return { ok: true, value: { sessionId: session.id } }
}

// Eager, idempotent generation of sessions from a weekly template (AD-50, I-25).
export async function generateSessions(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { templateId: ClassTemplateId; weeks: number; branchName: string },
): Promise<Result<{ created: number }, DomainError>> {
  const template = await deps.repo.getTemplate(ctx, input.templateId)
  if (!template) throw new Error(`Template not found: ${input.templateId}`)
  const service = await deps.repo.getService(ctx, template.serviceId)
  if (!service) throw new Error(`Service not found: ${template.serviceId}`)
  const room = template.roomId ? await deps.repo.getRoom(ctx, template.roomId) : null

  const today = localDateOf(deps.clock.now(), deps.studioConfig)
  const from = maxDate(template.validFrom, today)
  const to = minDate(template.validUntil, addDays(today, input.weeks * 7))
  const dates = occurrenceDates(template.dayOfWeek, from, to)

  const existing = new Set(
    (await deps.repo.listSessionStartsForTemplate(ctx, template.id)).map((i) => Number(i)),
  )

  // A template has no per-session override; the chain starts at the service (D14).
  const snapshot = await resolveSnapshot(deps, ctx, service, null)
  if (!snapshot.ok) return snapshot

  // The same rule the single-session path obeys. A template that generates thirteen Tuesday classes
  // outside the studio's hours is thirteen wrong classes, and it is the likelier mistake of the two.
  const studioHours = await deps.hours.getStudioHours(ctx)

  const dctx = decideContext(deps, ctx)
  const sessions: ClassSession[] = []
  const events: NewEvent[] = []

  for (const date of dates) {
    const { startsAt, endsAt } = localSlotToInstant(
      date,
      template.startTime,
      template.durationMinutes,
      deps.studioConfig,
    )
    if (existing.has(Number(startsAt))) continue // idempotent
    const session = buildSession({
      service,
      branchId: template.branchId,
      branchName: input.branchName,
      room,
      trainerId: template.trainerId,
      trainerName: null, // resolved when the identity module lands (denormalised)
      templateId: template.id,
      startsAt,
      endsAt,
      capacity: template.capacity,
      // A template generates studio inventory, never a slot already owned by a member (D13).
      assignedMemberId: null,
      policySnapshot: snapshot.value,
    })
    const decided = decideScheduleSession(dctx, session, room, studioHours)
    if (!decided.ok) return decided
    sessions.push(session)
    events.push(...decided.value)
  }

  if (sessions.length > 0) await deps.repo.saveSessions(ctx, sessions, events)
  return { ok: true, value: { created: sessions.length } }
}

// STUDIO SETTINGS (v1.27 S2). The one write path for everything on the settings screen.
//
// Changing a setting reaches nothing that already happened: every session carries its own resolved,
// stamped cancellation window (D14), and no field here rewrites one. A rule change applies to what
// the studio does NEXT.
export async function updateStudioSettings(
  deps: SchedulingDeps,
  ctx: TenantContext,
  next: StudioSettings,
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getStudioSettings(ctx)
  const events = decideUpdateStudioSettings(decideContext(deps, ctx), current, next)
  if (!events.ok) return events
  if (events.value.length === 0) return { ok: true, value: undefined } // nothing changed

  await deps.repo.saveStudioSettings(ctx, next, events.value)
  return { ok: true, value: undefined }
}

export async function cancelSession(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; reason: string; operationId?: OperationId },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getSession(ctx, input.sessionId)
  if (!current) throw new Error(`Session not found: ${input.sessionId}`)
  const dctx = decideContext(deps, ctx, input.operationId)
  const events = decideCancelSession(dctx, current, input.reason)
  if (!events.ok) return events
  if (events.value.length === 0) return { ok: true, value: undefined } // already cancelled
  await deps.repo.saveSession(
    ctx,
    { ...current, status: 'cancelled', cancellation: { reason: input.reason, at: dctx.now } },
    events.value,
  )
  return { ok: true, value: undefined }
}

export async function changeTrainer(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; trainerId: StaffUserId | null; trainerName: string | null; reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getSession(ctx, input.sessionId)
  if (!current) throw new Error(`Session not found: ${input.sessionId}`)
  const events = decideChangeTrainer(decideContext(deps, ctx), current, input.trainerId, input.reason)
  if (!events.ok) return events
  if (events.value.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveSession(
    ctx,
    { ...current, trainerId: input.trainerId, trainerName: input.trainerName },
    events.value,
  )
  return { ok: true, value: undefined }
}

// D13 — assign a private session to a member, re-assign it, or release it back to studio
// inventory (`memberId: null`). All guards are in the decider (private only, not started,
// no reservations yet).
export async function assignSessionMember(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; memberId: MemberId | null },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getSession(ctx, input.sessionId)
  if (!current) throw new Error(`Session not found: ${input.sessionId}`)
  const events = decideAssignSessionMember(decideContext(deps, ctx), current, input.memberId)
  if (!events.ok) return events
  if (events.value.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveSession(ctx, { ...current, assignedMemberId: input.memberId }, events.value)
  return { ok: true, value: undefined }
}

// Change the session's room (AD-48 checks in the decider). Only a not-yet-started
// session (I-26). Updates the denormalised roomId/roomName.
export async function changeRoom(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; roomId: RoomId | null; reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getSession(ctx, input.sessionId)
  if (!current) throw new Error(`Session not found: ${input.sessionId}`)
  const room = input.roomId ? await deps.repo.getRoom(ctx, input.roomId) : null
  const events = decideChangeRoom(decideContext(deps, ctx), current, room, input.reason)
  if (!events.ok) return events
  if (events.value.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveSession(
    ctx,
    { ...current, roomId: room ? room.id : null, roomName: room ? room.name : null },
    events.value,
  )
  return { ok: true, value: undefined }
}

// Change the session's capacity (never below bookedCount; not above the room, AD-48).
// Only a not-yet-started session (I-26).
export async function changeCapacity(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; capacity: number; reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getSession(ctx, input.sessionId)
  if (!current) throw new Error(`Session not found: ${input.sessionId}`)
  const room = current.roomId ? await deps.repo.getRoom(ctx, current.roomId) : null
  const events = decideChangeCapacity(decideContext(deps, ctx), current, room, input.capacity, input.reason)
  if (!events.ok) return events
  if (events.value.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveSession(ctx, { ...current, capacity: input.capacity }, events.value)
  return { ok: true, value: undefined }
}

// Set (or clear) the class note. Applies the note to the session state and appends the
// note_set event in one write. Empty text clears the note.
export async function setSessionNote(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; text: string; visibility: NoteVisibility },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getSession(ctx, input.sessionId)
  if (!current) throw new Error(`Session not found: ${input.sessionId}`)
  const dctx = decideContext(deps, ctx)
  const events = decideSetSessionNote(dctx, current, { text: input.text, visibility: input.visibility })
  if (!events.ok) return events
  const text = input.text.trim()
  const nextNote = text.length === 0 ? null : { text, visibility: input.visibility, setAt: dctx.now }
  await deps.repo.saveSession(ctx, { ...current, note: nextNote }, events.value)
  return { ok: true, value: undefined }
}
