'use server'

import {
  assignSessionMember,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  instant,
  isEligibleForService,
  cancelSession,
  changeCapacity,
  changeRoom,
  changeTrainer,
  createRoom,
  createService,
  createTemplate,
  deactivateRoom,
  deactivateService,
  deactivateTemplate,
  DEFAULT_STUDIO_CONFIG,
  FirestoreSchedulingRepository,
  generateSessions,
  publishServicePolicy,
  applyWeekDuplication,
  planWeekDuplication,
  reactivateRoom,
  reactivateService,
  scheduleSession,
  setSessionNote,
  setStudioDefaults,
  systemClock,
  updateRoom,
  updateService,
  updateTemplate,
  type BranchId,
  type ClassSessionId,
  type ClassTemplateId,
  type DomainError,
  type MemberId,
  type NoteVisibility,
  type RoomId,
  type SchedulingDeps,
  type ServiceId,
  type StaffUserId,
  type Weekday,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import type { BookingMember } from './booking'
import { adminDb } from '../firebase-admin'

function deps(): SchedulingDeps {
  return {
    repo: new FirestoreSchedulingRepository(adminDb()),
    clock: systemClock,
    studioConfig: DEFAULT_STUDIO_CONFIG,
  }
}

// AD-51: definitions are owner + platform_admin; daily session ops add reception.
const DEFS = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const policySchema = z.object({
  maxDaysInAdvance: z.number().int().min(0),
  // D14 — null = "inherit the studio default" (level 3 of the chain).
  cancellationWindowHours: z.number().int().min(0).nullable(),
  lateCancellationConsumesCredit: z.boolean(),
  noShowConsumesCredit: z.boolean(),
  attendanceDefaultOutcome: z.enum(['attended', 'no_show']),
  autoResolveAfterMinutes: z.number().int().min(0),
  // D11 — member self-booking is OPT-IN per service; absent ⇒ off.
  allowMemberSelfBooking: z.boolean().default(false),
})
const nonEmpty = z.string().min(1)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^\d{2}:\d{2}$/)

// ── Services (owner + platform_admin) ──
export async function createServiceAction(input: unknown) {
  const p = z
    .object({ name: nonEmpty, category: z.enum(['pilates_group', 'fitness', 'private']), policy: policySchema })
    .parse(input)
  return createService(deps(), await requireTenantContext(DEFS), p)
}
export async function updateServiceAction(input: unknown) {
  const p = z.object({ serviceId: nonEmpty, name: nonEmpty }).parse(input)
  return updateService(deps(), await requireTenantContext(DEFS), { serviceId: p.serviceId as ServiceId, name: p.name })
}
export async function publishServicePolicyAction(input: unknown) {
  const p = z.object({ serviceId: nonEmpty, policy: policySchema }).parse(input)
  return publishServicePolicy(deps(), await requireTenantContext(DEFS), {
    serviceId: p.serviceId as ServiceId,
    policy: p.policy,
  })
}
export async function deactivateServiceAction(input: unknown) {
  const p = z.object({ serviceId: nonEmpty, reason: nonEmpty }).parse(input)
  return deactivateService(deps(), await requireTenantContext(DEFS), {
    serviceId: p.serviceId as ServiceId,
    reason: p.reason,
  })
}
export async function reactivateServiceAction(input: unknown) {
  const p = z.object({ serviceId: nonEmpty }).parse(input)
  return reactivateService(deps(), await requireTenantContext(DEFS), { serviceId: p.serviceId as ServiceId })
}

// ── Rooms (owner + platform_admin) ──
export async function createRoomAction(input: unknown) {
  const p = z.object({ branchId: nonEmpty, name: nonEmpty, capacity: z.number().int().min(1) }).parse(input)
  return createRoom(deps(), await requireTenantContext(DEFS), { ...p, branchId: p.branchId as BranchId })
}
export async function updateRoomAction(input: unknown) {
  const p = z.object({ roomId: nonEmpty, name: nonEmpty, capacity: z.number().int().min(1) }).parse(input)
  return updateRoom(deps(), await requireTenantContext(DEFS), { ...p, roomId: p.roomId as RoomId })
}
export async function deactivateRoomAction(input: unknown) {
  const p = z.object({ roomId: nonEmpty, reason: nonEmpty }).parse(input)
  return deactivateRoom(deps(), await requireTenantContext(DEFS), { roomId: p.roomId as RoomId, reason: p.reason })
}
export async function reactivateRoomAction(input: unknown) {
  const p = z.object({ roomId: nonEmpty }).parse(input)
  return reactivateRoom(deps(), await requireTenantContext(DEFS), { roomId: p.roomId as RoomId })
}

// ── Templates (owner + platform_admin) ──
export async function createTemplateAction(input: unknown) {
  const p = z
    .object({
      serviceId: nonEmpty,
      branchId: nonEmpty,
      roomId: nonEmpty.nullable(),
      trainerId: nonEmpty.nullable(),
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: time,
      durationMinutes: z.number().int().min(1),
      capacity: z.number().int().min(1),
      validFrom: date,
      validUntil: date,
    })
    .parse(input)
  return createTemplate(deps(), await requireTenantContext(DEFS), {
    ...p,
    serviceId: p.serviceId as ServiceId,
    branchId: p.branchId as BranchId,
    roomId: p.roomId as RoomId | null,
    trainerId: p.trainerId as StaffUserId | null,
    dayOfWeek: p.dayOfWeek as Weekday,
  })
}
export async function deactivateTemplateAction(input: unknown) {
  const p = z.object({ templateId: nonEmpty, reason: nonEmpty }).parse(input)
  return deactivateTemplate(deps(), await requireTenantContext(DEFS), {
    templateId: p.templateId as ClassTemplateId,
    reason: p.reason,
  })
}

// ── Sessions (owner + receptionist + platform_admin) ──
export async function scheduleSessionAction(input: unknown) {
  const p = z
    .object({
      serviceId: nonEmpty,
      branchId: nonEmpty,
      branchName: nonEmpty,
      roomId: nonEmpty.nullable(),
      trainerId: nonEmpty.nullable(),
      trainerName: z.string().nullable(),
      date,
      startTime: time,
      durationMinutes: z.number().int().min(1),
      capacity: z.number().int().min(1),
      // D13 — assign at CREATION: null ⇒ an open PT slot (the default business model).
      assignedMemberId: z.string().nullable().optional(),
      // D14 — level 1 of the chain. Omitted ⇒ inherit the service, then the studio.
      cancellationWindowHours: z.number().int().min(0).max(720).nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  // D13 — the client's memberId is never trusted on its own: re-verify eligibility here.
  if (p.assignedMemberId) {
    const bad = await assertEligible(
      ctx,
      p.serviceId as ServiceId,
      p.assignedMemberId as MemberId,
      sessionStartMs(p.date, p.startTime),
    )
    if (bad) return { ok: false as const, error: bad }
  }
  return scheduleSession(deps(), ctx, {
    ...p,
    assignedMemberId: (p.assignedMemberId ?? null) as MemberId | null,
    cancellationWindowHours: p.cancellationWindowHours ?? null,
    serviceId: p.serviceId as ServiceId,
    branchId: p.branchId as BranchId,
    roomId: p.roomId as RoomId | null,
    trainerId: p.trainerId as StaffUserId | null,
  })
}
export async function generateSessionsAction(input: unknown) {
  const p = z.object({ templateId: nonEmpty, weeks: z.number().int().min(1).max(52), branchName: nonEmpty }).parse(input)
  return generateSessions(deps(), await requireTenantContext(OPS), {
    templateId: p.templateId as ClassTemplateId,
    weeks: p.weeks,
    branchName: p.branchName,
  })
}
export async function cancelSessionAction(input: unknown) {
  const p = z.object({ sessionId: nonEmpty, reason: nonEmpty }).parse(input)
  return cancelSession(deps(), await requireTenantContext(OPS), {
    sessionId: p.sessionId as ClassSessionId,
    reason: p.reason,
  })
}
export async function changeTrainerAction(input: unknown) {
  const p = z
    .object({ sessionId: nonEmpty, trainerId: nonEmpty.nullable(), trainerName: z.string().nullable(), reason: nonEmpty })
    .parse(input)
  return changeTrainer(deps(), await requireTenantContext(OPS), {
    sessionId: p.sessionId as ClassSessionId,
    trainerId: p.trainerId as StaffUserId | null,
    trainerName: p.trainerName,
    reason: p.reason,
  })
}
export async function changeRoomAction(input: unknown) {
  const p = z.object({ sessionId: nonEmpty, roomId: nonEmpty.nullable(), reason: nonEmpty }).parse(input)
  return changeRoom(deps(), await requireTenantContext(OPS), {
    sessionId: p.sessionId as ClassSessionId,
    roomId: p.roomId as RoomId | null,
    reason: p.reason,
  })
}
export async function changeCapacityAction(input: unknown) {
  const p = z.object({ sessionId: nonEmpty, capacity: z.number().int().min(1), reason: nonEmpty }).parse(input)
  return changeCapacity(deps(), await requireTenantContext(OPS), {
    sessionId: p.sessionId as ClassSessionId,
    capacity: p.capacity,
    reason: p.reason,
  })
}

// Studio-local 'YYYY-MM-DD' + 'HH:MM' → the instant the session starts (AD-52: +180).
function sessionStartMs(date: string, startTime: string): number {
  return Date.parse(`${date}T${startTime}:00Z`) - DEFAULT_STUDIO_CONFIG.utcOffsetMinutes * 60_000
}

// D13 — the members who may actually be reserved into a PT slot for THIS service.
//
// It is NOT a looser copy of the booking rule: it calls the same core predicate
// (`isEligibleForService`), which is the member-dependent half of `decideBooking` — status,
// validity, the category wall, the service wall (D12, incl. the legacy category-wide fallback),
// and remaining credit. It deliberately omits the SESSION-shaped checks (full / started /
// already-booked): those have nothing to do with the member and would empty the picker for
// reasons the owner did not ask about.
//
// One read of the studio's active entitlements + one of its members — not N reads per member.
export async function listEligibleMembersForServiceAction(input: unknown): Promise<readonly BookingMember[]> {
  const p = z.object({ serviceId: nonEmpty, startsAt: z.number().int().positive() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const db = adminDb()

  const service = await new FirestoreSchedulingRepository(db).getService(ctx, p.serviceId as ServiceId)
  if (!service) return []

  const at = instant(p.startsAt)
  const entitlements = await new FirestoreEntitlementRepository(db).listActive(ctx)
  const eligible = new Set(
    entitlements
      .filter((e) => isEligibleForService(e, service.category, service.id, at))
      .map((e) => e.memberId as string),
  )
  if (eligible.size === 0) return []

  const members = await new FirestoreMemberRepository(db).list(ctx)
  return members
    .filter((m) => m.status === 'active' && eligible.has(m.id))
    .map((m) => ({ id: m.id, fullName: m.fullName, phone: m.phone }))
}

// D13 — the SAME check, run again on the server before an assignment is written. A memberId
// arriving from a client is never trusted on its own (the picker is a convenience; this is the
// rule). Used by both create-with-assignment and assign-later.
async function assertEligible(
  ctx: Awaited<ReturnType<typeof requireTenantContext>>,
  serviceId: ServiceId,
  memberId: MemberId,
  at: number,
): Promise<DomainError | null> {
  const db = adminDb()
  const service = await new FirestoreSchedulingRepository(db).getService(ctx, serviceId)
  if (!service) return { code: 'member_not_eligible_for_service' }
  const ents = await new FirestoreEntitlementRepository(db).listActiveByMember(ctx, memberId)
  const ok = ents.some((e) => isEligibleForService(e, service.category, service.id, instant(at)))
  return ok ? null : { code: 'member_not_eligible_for_service' }
}

// D14 — the studio default cancellation window (level 3). Owner-only: it is a policy value.
export async function setStudioDefaultsAction(input: unknown) {
  const p = z
    .object({ defaultCancellationWindowHours: z.number().int().min(0).max(720).nullable() })
    .parse(input)
  return setStudioDefaults(deps(), await requireTenantContext(['owner', 'platform_admin']), {
    defaultCancellationWindowHours: p.defaultCancellationWindowHours,
  })
}

export async function getStudioDefaultsAction(): Promise<{ defaultCancellationWindowHours: number | null }> {
  const ctx = await requireTenantContext(OPS)
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  return { defaultCancellationWindowHours: settings?.defaultCancellationWindowHours ?? null }
}

// D13 — assign a PT (private) session to a member, or release it (memberId: null). All the
// guards live in the decider: private only, not started, no reservations yet.
export async function assignSessionMemberAction(input: unknown) {
  const p = z.object({ sessionId: nonEmpty, memberId: z.string().nullable() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  // D13 — reserving a slot FOR someone only makes sense if she could actually book it.
  if (p.memberId) {
    const session = await new FirestoreSchedulingRepository(adminDb()).getSession(
      ctx,
      p.sessionId as ClassSessionId,
    )
    if (session) {
      const bad = await assertEligible(ctx, session.serviceId, p.memberId as MemberId, session.startsAt)
      if (bad) return { ok: false as const, error: bad }
    }
  }
  return assignSessionMember(deps(), ctx, {
    sessionId: p.sessionId as ClassSessionId,
    memberId: (p.memberId ?? null) as MemberId | null,
  })
}

// "Bu haftayı tekrarla" — dry-run (apply:false) returns the plan (create/skip/conflict)
// for a pre-flight summary; apply:true creates the non-conflicting future sessions.
export async function duplicateWeekAction(input: unknown) {
  const p = z
    .object({
      weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      weeks: z.number().int().min(1).max(52),
      apply: z.boolean(),
      // D23 — target days the owner ticked to skip. The calendar never skips a day on its own.
      skipDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const arg = { weekStartDate: p.weekStartDate, weeks: p.weeks, skipDates: p.skipDates }
  if (p.apply) return applyWeekDuplication(deps(), ctx, arg)
  const plan = await planWeekDuplication(deps(), ctx, arg)
  return { ok: true as const, value: { created: 0, plan } }
}

// Set the class note (Ders Notu). Empty text clears it. Visibility 'members' surfaces it
// in the member portal (v1.20). Owner + reception.
export async function setSessionNoteAction(input: unknown) {
  const p = z
    .object({ sessionId: nonEmpty, text: z.string(), visibility: z.enum(['staff', 'members']) })
    .parse(input)
  return setSessionNote(deps(), await requireTenantContext(OPS), {
    sessionId: p.sessionId as ClassSessionId,
    text: p.text,
    visibility: p.visibility as NoteVisibility,
  })
}
// Template edits are definitions: owner + platform_admin (AD-51).
export async function updateTemplateAction(input: unknown) {
  const p = z
    .object({
      templateId: nonEmpty,
      roomId: nonEmpty.nullable(),
      trainerId: nonEmpty.nullable(),
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: time,
      durationMinutes: z.number().int().min(1),
      capacity: z.number().int().min(1),
      validFrom: date,
      validUntil: date,
      reason: nonEmpty,
    })
    .parse(input)
  return updateTemplate(deps(), await requireTenantContext(DEFS), {
    templateId: p.templateId as ClassTemplateId,
    roomId: p.roomId as RoomId | null,
    trainerId: p.trainerId as StaffUserId | null,
    dayOfWeek: p.dayOfWeek as Weekday,
    startTime: p.startTime,
    durationMinutes: p.durationMinutes,
    capacity: p.capacity,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
    reason: p.reason,
  })
}
