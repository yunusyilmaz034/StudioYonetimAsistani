import type {
  BranchId,
  Category,
  ClassSessionId,
  ClassTemplateId,
  Instant,
  LocalDate,
  RoomId,
  ServiceId,
  StaffUserId,
  StudioId,
} from '../../../shared'

// The scheduling-relevant policy: reservation window, cancellation, late, and
// attendance defaults. Embedded on the Service, versioned, snapshotted onto each
// session (AD-49). Freeze/credit policy stays product-attached (Doc 2 §10).
export interface SchedulingPolicy {
  readonly maxDaysInAdvance: number
  readonly cancellationWindowHours: number
  readonly lateCancellationConsumesCredit: boolean
  readonly noShowConsumesCredit: boolean
  readonly attendanceDefaultOutcome: 'attended' | 'no_show'
  readonly autoResolveAfterMinutes: number
}

export interface Service {
  readonly id: ServiceId
  readonly studioId: StudioId
  readonly name: string
  readonly category: Category // immutable after creation (I-22)
  readonly policy: SchedulingPolicy
  readonly policyVersion: number
  readonly active: boolean
}

export interface Room {
  readonly id: RoomId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly name: string
  readonly capacity: number
  readonly active: boolean
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ClassTemplate {
  readonly id: ClassTemplateId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly serviceId: ServiceId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly dayOfWeek: Weekday
  readonly startTime: string // 'HH:MM' local
  readonly durationMinutes: number
  readonly capacity: number
  readonly validFrom: LocalDate
  readonly validUntil: LocalDate
  readonly active: boolean
}

export type ClassSessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

// The class note (Ders Notu). Free text is the core — kept intact for members and,
// later, AI (owner directive). `visibility` decides whether it reaches the member
// portal. EXTENSIBLE BY DESIGN: future additions (attachments, links, ai suggestions)
// are ADDITIVE optional fields on this record and on the note_set event — events are
// versioned, so adding an optional field never breaks the existing model.
export type NoteVisibility = 'staff' | 'members'
export interface SessionNote {
  readonly text: string
  readonly visibility: NoteVisibility
  readonly setAt: Instant
  // future (do not build yet): attachments?, links?, aiSuggestion? — all additive.
}

export interface SessionCancellation {
  readonly reason: string
  readonly at: Instant
}

export interface ServicePolicyRef {
  readonly serviceId: ServiceId
  readonly version: number
}

export interface ClassSession {
  readonly id: ClassSessionId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly serviceId: ServiceId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly templateId: ClassTemplateId | null
  readonly category: Category // snapshot of the service's category (I-22)
  readonly startsAt: Instant
  readonly endsAt: Instant
  readonly capacity: number
  readonly status: ClassSessionStatus
  readonly cancellation: SessionCancellation | null
  readonly policyRef: ServicePolicyRef
  readonly policySnapshot: SchedulingPolicy // I-24
  readonly bookedCount: number // starts 0; reservations are v1.8
  readonly attendedCount: number
  readonly note?: SessionNote | null // the class note (Ders Notu); optional/additive
  // denormalised for the roster/calendar read (rebuildable):
  readonly serviceName: string
  readonly roomName: string | null
  readonly trainerName: string | null
  readonly branchName: string
}
