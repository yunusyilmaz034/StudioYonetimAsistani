import { ulid } from 'ulid'

import type { Brand } from './brand'

// ── Prefixed ULID identifiers (AD-16). The prefix makes a stray id
//    self-describing at 3 a.m.; the brand makes a type-confusion a compile error. ──

export type StudioId = Brand<string, 'StudioId'>
export type BranchId = Brand<string, 'BranchId'>
export type MemberId = Brand<string, 'MemberId'>
export type EntitlementId = Brand<string, 'EntitlementId'>
export type ProductId = Brand<string, 'ProductId'>
export type ServiceId = Brand<string, 'ServiceId'>
export type RoomId = Brand<string, 'RoomId'>
export type ClassSessionId = Brand<string, 'ClassSessionId'>
export type ClassTemplateId = Brand<string, 'ClassTemplateId'>
export type ReservationId = Brand<string, 'ReservationId'>
export type PaymentId = Brand<string, 'PaymentId'>
export type CheckInId = Brand<string, 'CheckInId'>
export type PolicyId = Brand<string, 'PolicyId'>
export type StaffUserId = Brand<string, 'StaffUserId'>
export type EventId = Brand<string, 'EventId'>
export type CommandId = Brand<string, 'CommandId'>
export type CorrelationId = Brand<string, 'CorrelationId'>

// Actor ids that are NOT minted ULIDs — well-known string identifiers such as
// 'attendance_auto_resolver' or 'import_2026_07' (Doc 4 §5).
export type SystemJobId = Brand<string, 'SystemJobId'>
export type AgentId = Brand<string, 'AgentId'>
export type DeviceId = Brand<string, 'DeviceId'>
export type MigrationRunId = Brand<string, 'MigrationRunId'>

const PREFIX = {
  studio: 'std',
  branch: 'brn',
  member: 'mem',
  entitlement: 'ent',
  product: 'prd',
  service: 'svc',
  room: 'rom',
  classSession: 'cls',
  classTemplate: 'tpl',
  reservation: 'res',
  payment: 'pay',
  checkIn: 'chk',
  policy: 'pol',
  staffUser: 'usr',
  event: 'evt',
  command: 'cmd',
  correlation: 'cor',
  waitlistEntry: 'wlt', // D20
  // ── Training & Progress (Plus Phase 7) ──
  exercise: 'exr',
  program: 'prg',
  measurement: 'mea',
  trainingFeedback: 'fbk',
  progressPhoto: 'pht',
} as const

// ULID gives lexicographic time-ordering; the prefix disambiguates the id kind.
// Randomness lives here, outside `domain/`, which is why this is in `shared/`.
function mint(prefix: string): string {
  return `${prefix}_${ulid()}`
}

export const newStudioId = (): StudioId => mint(PREFIX.studio) as StudioId
export const newBranchId = (): BranchId => mint(PREFIX.branch) as BranchId
export const newMemberId = (): MemberId => mint(PREFIX.member) as MemberId
export const newEntitlementId = (): EntitlementId => mint(PREFIX.entitlement) as EntitlementId
export const newProductId = (): ProductId => mint(PREFIX.product) as ProductId
export const newServiceId = (): ServiceId => mint(PREFIX.service) as ServiceId
export const newRoomId = (): RoomId => mint(PREFIX.room) as RoomId
export const newClassSessionId = (): ClassSessionId => mint(PREFIX.classSession) as ClassSessionId
export const newClassTemplateId = (): ClassTemplateId => mint(PREFIX.classTemplate) as ClassTemplateId
export const newReservationId = (): ReservationId => mint(PREFIX.reservation) as ReservationId
export const newPaymentId = (): PaymentId => mint(PREFIX.payment) as PaymentId
export const newCheckInId = (): CheckInId => mint(PREFIX.checkIn) as CheckInId
export const newPolicyId = (): PolicyId => mint(PREFIX.policy) as PolicyId
export const newStaffUserId = (): StaffUserId => mint(PREFIX.staffUser) as StaffUserId
export const newEventId = (): EventId => mint(PREFIX.event) as EventId
export const newCommandId = (): CommandId => mint(PREFIX.command) as CommandId
export const newCorrelationId = (): CorrelationId => mint(PREFIX.correlation) as CorrelationId
export const newWaitlistEntryId = (): string => mint(PREFIX.waitlistEntry)
export const newExerciseId = (): string => mint(PREFIX.exercise)
export const newProgramId = (): string => mint(PREFIX.program)
export const newMeasurementId = (): string => mint(PREFIX.measurement)
export const newTrainingFeedbackId = (): string => mint(PREFIX.trainingFeedback)
export const newProgressPhotoId = (): string => mint(PREFIX.progressPhoto)
