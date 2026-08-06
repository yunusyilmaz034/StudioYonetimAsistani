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
// v1.31 — the member's own record that she TRAINED a programme day. See the payload below for why
// this is not a check-in and can never be counted as one.
export const WORKOUT_DAY_COMPLETED = 'workout.day_completed'
export const WORKOUT_DAY_UNDONE = 'workout.day_undone'

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

// ── WORKOUT LOG (v1.31) — a DECLARATION, never an observation ───────────────────────────────
//
// The studio already records that a member walked through the door: `member.checked_in`, written by
// the desk or the kiosk, which is the studio OBSERVING her. This event is a different thing entirely
// — the member telling us she trained. She can tick it at home; she can train and forget to tick it.
//
// The two must never be added together, and the reason is non-negotiable #11: a presumption is never
// written down as an observation. Attendance, occupancy, continuity and the churn signal are read
// from check-ins ONLY. This event feeds programme progress ONLY. They meet in exactly one place — the
// staff screen, side by side and clearly labelled — because the GAP between them is itself the
// signal: "six workouts ticked, nine days since she was last in the building" is worth knowing, and
// summing them would destroy it.
//
// No PII (#6): sets, reps, weights and her note are the member's own record and live on the log
// document under her member scope. The event carries the FACT and the shape — which day of which
// programme version, on which date, how much of it she filled in.
export type WorkoutDayCompletedPayload = {
  readonly logId: string
  readonly programId: string
  readonly programVersion: number
  readonly dayOrder: number
  /** The studio-local date she says she trained, `YYYY-MM-DD`. Domain time, not the clock. */
  readonly performedOn: string
  readonly exerciseCount: number
  /** How many of them she actually filled in — the rest were done as prescribed. */
  readonly loggedCount: number
  readonly hasNote: boolean
}
// Corrections are compensating events (#9), never a deleted log: she ticked the wrong day, or ticked
// it twice. The cycle counter reads the difference, so an undo moves her back a day rather than
// erasing that she was ever there.
export type WorkoutDayUndonePayload = { readonly logId: string; readonly programId: string; readonly dayOrder: number; readonly reason: string }
