'use server'

import {
  cancelSession,
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
  reactivateRoom,
  reactivateService,
  scheduleSession,
  systemClock,
  updateRoom,
  updateService,
  type BranchId,
  type ClassSessionId,
  type ClassTemplateId,
  type RoomId,
  type SchedulingDeps,
  type ServiceId,
  type StaffUserId,
  type Weekday,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
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
  cancellationWindowHours: z.number().int().min(0),
  lateCancellationConsumesCredit: z.boolean(),
  noShowConsumesCredit: z.boolean(),
  attendanceDefaultOutcome: z.enum(['attended', 'no_show']),
  autoResolveAfterMinutes: z.number().int().min(0),
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
    })
    .parse(input)
  return scheduleSession(deps(), await requireTenantContext(OPS), {
    ...p,
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
