import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type BranchId,
  type Category,
  type ClassSessionId,
  type ClassTemplateId,
  type EventId,
  type Instant,
  type LocalDate,
  type NewEvent,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import type {
  ClassSession,
  ClassSessionStatus,
  ClassTemplate,
  Room,
  SchedulingPolicy,
  Service,
  Weekday,
} from '../domain/types'

const toTs = (i: Instant): Timestamp => Timestamp.fromMillis(i)
const fromTs = (t: Timestamp): Instant => instant(t.toMillis())

export function serviceToFirestore(s: Service): DocumentData {
  return {
    studioId: s.studioId,
    name: s.name,
    category: s.category,
    policy: s.policy,
    policyVersion: s.policyVersion,
    active: s.active,
    updatedAt: FieldValue.serverTimestamp(),
  }
}
export function serviceFromFirestore(id: ServiceId, d: DocumentData): Service {
  return {
    id,
    studioId: d.studioId as StudioId,
    name: d.name as string,
    category: d.category as Category,
    policy: d.policy as SchedulingPolicy,
    policyVersion: d.policyVersion as number,
    active: d.active as boolean,
  }
}

export function roomToFirestore(r: Room): DocumentData {
  return {
    studioId: r.studioId,
    branchId: r.branchId,
    name: r.name,
    capacity: r.capacity,
    active: r.active,
    updatedAt: FieldValue.serverTimestamp(),
  }
}
export function roomFromFirestore(id: RoomId, d: DocumentData): Room {
  return {
    id,
    studioId: d.studioId as StudioId,
    branchId: d.branchId as BranchId,
    name: d.name as string,
    capacity: d.capacity as number,
    active: d.active as boolean,
  }
}

export function templateToFirestore(t: ClassTemplate): DocumentData {
  return {
    studioId: t.studioId,
    branchId: t.branchId,
    serviceId: t.serviceId,
    roomId: t.roomId,
    trainerId: t.trainerId,
    dayOfWeek: t.dayOfWeek,
    startTime: t.startTime,
    durationMinutes: t.durationMinutes,
    capacity: t.capacity,
    validFrom: t.validFrom,
    validUntil: t.validUntil,
    active: t.active,
    updatedAt: FieldValue.serverTimestamp(),
  }
}
export function templateFromFirestore(id: ClassTemplateId, d: DocumentData): ClassTemplate {
  return {
    id,
    studioId: d.studioId as StudioId,
    branchId: d.branchId as BranchId,
    serviceId: d.serviceId as ServiceId,
    roomId: (d.roomId as RoomId | null) ?? null,
    trainerId: (d.trainerId as StaffUserId | null) ?? null,
    dayOfWeek: d.dayOfWeek as Weekday,
    startTime: d.startTime as string,
    durationMinutes: d.durationMinutes as number,
    capacity: d.capacity as number,
    validFrom: d.validFrom as LocalDate,
    validUntil: d.validUntil as LocalDate,
    active: d.active as boolean,
  }
}

export function sessionToFirestore(s: ClassSession): DocumentData {
  return {
    studioId: s.studioId,
    branchId: s.branchId,
    serviceId: s.serviceId,
    roomId: s.roomId,
    trainerId: s.trainerId,
    templateId: s.templateId,
    category: s.category,
    startsAt: toTs(s.startsAt),
    endsAt: toTs(s.endsAt),
    capacity: s.capacity,
    status: s.status,
    cancellation: s.cancellation
      ? { reason: s.cancellation.reason, at: toTs(s.cancellation.at) }
      : null,
    policyRef: s.policyRef,
    policySnapshot: s.policySnapshot,
    bookedCount: s.bookedCount,
    attendedCount: s.attendedCount,
    note: s.note ? { text: s.note.text, visibility: s.note.visibility, setAt: toTs(s.note.setAt) } : null,
    serviceName: s.serviceName,
    roomName: s.roomName,
    trainerName: s.trainerName,
    branchName: s.branchName,
    updatedAt: FieldValue.serverTimestamp(),
  }
}
export function sessionFromFirestore(id: ClassSessionId, d: DocumentData): ClassSession {
  const c = d.cancellation as { reason: string; at: Timestamp } | null
  return {
    id,
    studioId: d.studioId as StudioId,
    branchId: d.branchId as BranchId,
    serviceId: d.serviceId as ServiceId,
    roomId: (d.roomId as RoomId | null) ?? null,
    trainerId: (d.trainerId as StaffUserId | null) ?? null,
    templateId: (d.templateId as ClassTemplateId | null) ?? null,
    category: d.category as Category,
    startsAt: fromTs(d.startsAt as Timestamp),
    endsAt: fromTs(d.endsAt as Timestamp),
    capacity: d.capacity as number,
    status: d.status as ClassSessionStatus,
    cancellation: c ? { reason: c.reason, at: fromTs(c.at) } : null,
    policyRef: d.policyRef as ClassSession['policyRef'],
    policySnapshot: d.policySnapshot as SchedulingPolicy,
    bookedCount: d.bookedCount as number,
    attendedCount: d.attendedCount as number,
    note: d.note
      ? {
          text: (d.note as { text: string }).text,
          visibility: (d.note as { visibility: 'staff' | 'members' }).visibility,
          setAt: fromTs((d.note as { setAt: Timestamp }).setAt),
        }
      : null,
    serviceName: d.serviceName as string,
    roomName: (d.roomName as string | null) ?? null,
    trainerName: (d.trainerName as string | null) ?? null,
    branchName: d.branchName as string,
  }
}

export function eventToFirestore(e: NewEvent): { id: EventId; data: DocumentData } {
  const id = newEventId()
  return { id, data: { ...e, occurredAt: toTs(e.occurredAt), recordedAt: FieldValue.serverTimestamp() } }
}
