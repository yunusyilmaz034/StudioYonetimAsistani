import type { BranchId, Category, Instant, MemberId, RoomId, ServiceId, StaffUserId } from '../../shared'
import type { CancellationWindowSource, NoteVisibility } from './domain/types'

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
// The session moved to a new time (Plus Phase 2 — Edit Experience). A COMPENSATING event: the log
// keeps the old time and records the new one; the class document holds the current time. Bookings ride
// with the session, so a member booked into it is now booked at the new time.
export const CLASS_SESSION_RESCHEDULED = 'class_session.rescheduled'
export const CLASS_SESSION_NOTE_SET = 'class_session.note_set'
export const CLASS_SESSION_ASSIGNED = 'class_session.assigned'
export const STUDIO_SETTINGS_UPDATED = 'studio.settings_updated'

// `class_session.scheduled` is the only versioned-up event in scheduling:
//   v2 (D13) adds `assignedMemberId`
//   v3 (D14) adds the EFFECTIVE cancellation window and where it came from
// Every other type is still v1.
export const CLASS_SESSION_SCHEDULED_VERSION = 3

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

// v2 (D13, v1.21) — carries `assignedMemberId`. A v1 event predates PT ownership and is read
// as `null` (unassigned) by the upcaster; it is never rewritten. See `upcasters.ts`.
export type ClassSessionScheduledPayload = {
  readonly serviceId: ServiceId
  readonly branchId: BranchId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly assignedMemberId: MemberId | null
  readonly category: Category
  readonly startsAt: Instant
  readonly endsAt: Instant
  readonly capacity: number
  readonly policyVersion: number
  // v3 (D14) — the window this session was actually created under, and which level of the
  // chain answered. `null` ONLY on a pre-v3 event: the old payload did not record it, and an
  // upcaster may not invent what it cannot know. The session document still holds the number.
  readonly cancellationWindowHours: number | null
  readonly cancellationWindowSource: CancellationWindowSource | null
}

// D14 — the studio-level defaults changed. Only affects sessions created AFTER it.
export type StudioSettingsUpdatedPayload = {
  readonly defaultCancellationWindowHours: number | null
  readonly previousDefaultCancellationWindowHours: number | null
}

// D13 — assignment changed after the session was created (assigned, re-assigned, or released
// back to studio inventory). `to: null` is a release.
export type ClassSessionAssignedPayload = {
  readonly from: MemberId | null
  readonly to: MemberId | null
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
export type ClassSessionRescheduledPayload = {
  readonly fromStartsAt: Instant
  readonly toStartsAt: Instant
  readonly fromEndsAt: Instant
  readonly toEndsAt: Instant
  readonly reason: string
}
// A template edit affects only FUTURE generations — already-generated sessions keep
// their snapshot (idempotent generation, AD-50). Delta as changed field names (AD-19).
export type ClassTemplateUpdatedPayload = {
  readonly changedFields: readonly string[]
  readonly reason: string
}
// The class note (Ders Notu). Free text preserved intact (AI reads it later). No PII in
// the payload beyond what staff type; reception is instructed not to enter third-party
// identifying data (same standing rule as member notes). EXTENSIBLE: future optional
// fields (attachments, links, aiSuggestion) are additive and won't break v1.
export type ClassSessionNoteSetPayload = {
  readonly text: string
  readonly visibility: NoteVisibility
}
