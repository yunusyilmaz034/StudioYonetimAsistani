import type { BranchId, Category, Instant, RoomId, ServiceId, StaffUserId } from '../../shared'

// No PII in any payload (I-13). Scheduling entities are referenced by opaque id;
// the payload carries the delta plus the numbers changed (AD-19). Broad from day
// one (AD-52 / decision #3): new event TYPES may be added later without migration.

export const SERVICE_CREATED = 'service.created'
export const SERVICE_UPDATED = 'service.updated'
export const SERVICE_POLICY_PUBLISHED = 'service.policy_published'
export const SERVICE_DEACTIVATED = 'service.deactivated'
export const SERVICE_REACTIVATED = 'service.reactivated'

export const ROOM_CREATED = 'room.created'
export const ROOM_UPDATED = 'room.updated'
export const ROOM_DEACTIVATED = 'room.deactivated'
export const ROOM_REACTIVATED = 'room.reactivated'

export const CLASS_TEMPLATE_CREATED = 'class_template.created'
export const CLASS_TEMPLATE_UPDATED = 'class_template.updated'
export const CLASS_TEMPLATE_DEACTIVATED = 'class_template.deactivated'

export const CLASS_SESSION_SCHEDULED = 'class_session.scheduled'
export const CLASS_SESSION_CANCELLED = 'class_session.cancelled'
export const CLASS_SESSION_TRAINER_CHANGED = 'class_session.trainer_changed'
export const CLASS_SESSION_ROOM_CHANGED = 'class_session.room_changed'
export const CLASS_SESSION_CAPACITY_CHANGED = 'class_session.capacity_changed'

export type ServiceCreatedPayload = {
  readonly name: string
  readonly category: Category
  readonly policyVersion: number
}
export type ChangedFieldsPayload = { readonly changedFields: readonly string[] }
export type ServicePolicyPublishedPayload = {
  readonly policyVersion: number
  readonly changedFields: readonly string[]
}
export type ReasonPayload = { readonly reason: string }
export type EmptyPayload = Record<string, never>

export type RoomCreatedPayload = {
  readonly branchId: BranchId
  readonly name: string
  readonly capacity: number
}

export type ClassTemplateCreatedPayload = {
  readonly serviceId: ServiceId
  readonly branchId: BranchId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly dayOfWeek: number
  readonly startTime: string
  readonly durationMinutes: number
  readonly capacity: number
  readonly validFrom: string
  readonly validUntil: string
}

export type ClassSessionScheduledPayload = {
  readonly serviceId: ServiceId
  readonly branchId: BranchId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly category: Category
  readonly startsAt: Instant
  readonly endsAt: Instant
  readonly capacity: number
  readonly policyVersion: number
}
export type ClassSessionCancelledPayload = {
  readonly reason: string
  readonly startsAt: Instant
}
export type ClassSessionTrainerChangedPayload = {
  readonly from: StaffUserId | null
  readonly to: StaffUserId | null
  readonly reason: string
}
export type ClassSessionRoomChangedPayload = {
  readonly fromRoomId: RoomId | null
  readonly toRoomId: RoomId | null
  readonly reason: string
}
export type ClassSessionCapacityChangedPayload = {
  readonly fromCapacity: number
  readonly toCapacity: number
  readonly reason: string
}
// A template edit affects only FUTURE generations — already-generated sessions keep
// their snapshot (idempotent generation, AD-50). Delta as changed field names (AD-19).
export type ClassTemplateUpdatedPayload = {
  readonly changedFields: readonly string[]
  readonly reason: string
}
