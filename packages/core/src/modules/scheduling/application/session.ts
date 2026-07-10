import {
  newClassSessionId,
  type BranchId,
  type ClassSessionId,
  type ClassTemplateId,
  type DomainError,
  type Instant,
  type LocalDate,
  type NewEvent,
  type Result,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import {
  decideCancelSession,
  decideChangeTrainer,
  decideScheduleSession,
} from '../domain/decide'
import type { ClassSession, Room, Service } from '../domain/types'
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
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    capacity: params.capacity,
    status: 'scheduled',
    cancellation: null,
    policyRef: { serviceId: service.id, version: service.policyVersion },
    policySnapshot: service.policy,
    bookedCount: 0,
    attendedCount: 0,
    serviceName: service.name,
    roomName: room ? room.name : null,
    trainerName: params.trainerName,
    branchName: params.branchName,
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
  })
  const events = decideScheduleSession(decideContext(deps, ctx), session, room)
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
    })
    const decided = decideScheduleSession(dctx, session, room)
    if (!decided.ok) return decided
    sessions.push(session)
    events.push(...decided.value)
  }

  if (sessions.length > 0) await deps.repo.saveSessions(ctx, sessions, events)
  return { ok: true, value: { created: sessions.length } }
}

export async function cancelSession(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getSession(ctx, input.sessionId)
  if (!current) throw new Error(`Session not found: ${input.sessionId}`)
  const dctx = decideContext(deps, ctx)
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
  await deps.repo.saveSession(
    ctx,
    { ...current, trainerId: input.trainerId, trainerName: input.trainerName },
    events.value,
  )
  return { ok: true, value: undefined }
}
