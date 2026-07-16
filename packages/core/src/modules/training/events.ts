import type { Instant } from '../../shared'
import type { FeedbackReason, PhotoAngle, ProgramStatus } from './domain/types'

// Training events. No PII in payloads (I-13): a measurement's numbers, a photo's URL, a feedback's
// message live on member-scoped state, not the log. The events record THAT a programme was published
// (with which version), THAT a measurement was recorded, THAT feedback was left — the behaviour, not
// the body. Program versions are append-only; a revision is a new version, never an edit (§4/§6).

export const EXERCISE_UPSERTED = 'exercise.upserted'
export const PROGRAM_CREATED = 'program.created'
export const PROGRAM_VERSION_PUBLISHED = 'program.version_published'
export const PROGRAM_STATUS_CHANGED = 'program.status_changed'
export const MEASUREMENT_RECORDED = 'measurement.recorded'
export const MEASUREMENT_CORRECTED = 'measurement.corrected'
export const TRAINING_FEEDBACK_LEFT = 'training_feedback.left'
export const TRAINING_FEEDBACK_ANSWERED = 'training_feedback.answered'
export const TRAINING_FEEDBACK_RESOLVED = 'training_feedback.resolved'
export const PROGRESS_PHOTO_ADDED = 'progress_photo.added'
export const PROGRESS_PHOTO_REMOVED = 'progress_photo.removed'

export type ExerciseUpsertedPayload = { readonly exerciseId: string; readonly version: number; readonly created: boolean }
export type ProgramCreatedPayload = { readonly programId: string; readonly trainerId: string }
export type ProgramVersionPublishedPayload = { readonly programId: string; readonly version: number; readonly dayCount: number; readonly exerciseCount: number }
export type ProgramStatusChangedPayload = { readonly programId: string; readonly from: ProgramStatus; readonly to: ProgramStatus }
// A measurement event carries the FACT + which metrics were present, never the values (they are the
// member's PII and live on the measurement record).
export type MeasurementRecordedPayload = { readonly measurementId: string; readonly takenOn: string; readonly metrics: readonly string[] }
export type MeasurementCorrectedPayload = { readonly measurementId: string; readonly correctedFrom: string; readonly reason: string }
export type FeedbackLeftPayload = { readonly feedbackId: string; readonly programId: string; readonly programVersion: number; readonly exerciseId: string; readonly reason: FeedbackReason }
export type FeedbackAnsweredPayload = { readonly feedbackId: string }
export type FeedbackResolvedPayload = { readonly feedbackId: string }
// The photo URL/path NEVER enters the event (member PII, §2). Only the fact + the angle/date.
export type ProgressPhotoAddedPayload = { readonly photoId: string; readonly angle: PhotoAngle; readonly takenOn: string }
export type ProgressPhotoRemovedPayload = { readonly photoId: string; readonly reason: string; readonly at: Instant }
