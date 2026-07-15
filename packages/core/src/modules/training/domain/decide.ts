import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  EXERCISE_UPSERTED,
  MEASUREMENT_CORRECTED,
  MEASUREMENT_RECORDED,
  PROGRAM_CREATED,
  PROGRAM_STATUS_CHANGED,
  PROGRAM_VERSION_PUBLISHED,
  PROGRESS_PHOTO_ADDED,
  PROGRESS_PHOTO_REMOVED,
  TRAINING_FEEDBACK_ANSWERED,
  TRAINING_FEEDBACK_LEFT,
  TRAINING_FEEDBACK_RESOLVED,
} from '../events'
import type {
  Exercise,
  Measurement,
  Program,
  ProgramDay,
  ProgramStatus,
  ProgramVersion,
  ProgressPhoto,
  TrainingFeedback,
} from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(ctx: DecideContext, kind: AggregateKind, id: string, memberId: string, extra: Record<string, string> = {}) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind, id },
    related: { memberId: memberId as MemberId, ...extra },
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// ── Programme ──
export function decideCreateProgram(ctx: DecideContext, program: Program): Result<{ next: Program; events: NewEvent[] }, DomainError> {
  if (program.trainerId.trim().length === 0) return err({ code: 'reason_required' })
  return ok({
    next: program,
    events: [{ ...base(ctx, 'program', program.id, program.memberId, { programId: program.id }), type: PROGRAM_CREATED, payload: { programId: program.id, trainerId: program.trainerId } }],
  })
}

// Publish a NEW version — the programme is never edited in place (§4/§6). The days passed here are
// already snapshotted (name/media/sets frozen from the library at publish time). Idempotent: a version
// number that already exists is refused rather than silently overwriting history.
export function decidePublishVersion(
  ctx: DecideContext,
  program: Program,
  days: readonly ProgramDay[],
  note: string,
): Result<{ next: Program; events: NewEvent[] }, DomainError> {
  if (program.status === 'archived') return err({ code: 'program_archived' })
  if (days.length === 0) return err({ code: 'program_empty' })
  const nextVersionNo = program.currentVersion + 1
  if (program.versions.some((v) => v.version === nextVersionNo)) return err({ code: 'program_version_conflict' })

  const version: ProgramVersion = { version: nextVersionNo, note, days, publishedBy: ctx.actor, publishedAt: ctx.now }
  const next: Program = {
    ...program,
    status: program.status === 'draft' ? 'active' : program.status,
    currentVersion: nextVersionNo,
    versions: [...program.versions, version],
    updatedAt: ctx.now,
  }
  const exerciseCount = days.reduce((n, d) => n + d.exercises.length, 0)
  return ok({
    next,
    events: [{ ...base(ctx, 'program', program.id, program.memberId, { programId: program.id }), type: PROGRAM_VERSION_PUBLISHED, payload: { programId: program.id, version: nextVersionNo, dayCount: days.length, exerciseCount } }],
  })
}

export function decideChangeProgramStatus(ctx: DecideContext, program: Program, to: ProgramStatus): Result<{ next: Program; events: NewEvent[] }, DomainError> {
  if (program.status === to) return ok({ next: program, events: [] })
  if (program.status === 'archived') return err({ code: 'program_archived' })
  const next: Program = { ...program, status: to, updatedAt: ctx.now }
  return ok({ next, events: [{ ...base(ctx, 'program', program.id, program.memberId, { programId: program.id }), type: PROGRAM_STATUS_CHANGED, payload: { programId: program.id, from: program.status, to } }] })
}

// ── Measurement — every reading is a NEW record; a wrong one is CORRECTED (a compensating record),
//    never edited (§1). ──
export function decideRecordMeasurement(ctx: DecideContext, m: Measurement): { next: Measurement; events: NewEvent[] } {
  const metrics = Object.entries({
    weightKg: m.weightKg, fatPercent: m.fatPercent, musclePercent: m.musclePercent, waterPercent: m.waterPercent,
    bmi: m.bmi, bmr: m.bmr, visceralFat: m.visceralFat,
  }).filter(([, v]) => v !== null).map(([k]) => k)
  const type = m.correctedFrom ? MEASUREMENT_CORRECTED : MEASUREMENT_RECORDED
  const payload = m.correctedFrom
    ? { measurementId: m.id, correctedFrom: m.correctedFrom, reason: m.note }
    : { measurementId: m.id, takenOn: m.takenOn, metrics: [...metrics, ...Object.keys(m.circumferences)] }
  return { next: m, events: [{ ...base(ctx, 'measurement', m.id, m.memberId), type, payload }] }
}

// ── Feedback (bound to a version + exercise) ──
export function decideLeaveFeedback(ctx: DecideContext, f: TrainingFeedback): Result<{ next: TrainingFeedback; events: NewEvent[] }, DomainError> {
  if (f.message.trim().length === 0) return err({ code: 'note_required' })
  return ok({ next: f, events: [{ ...base(ctx, 'training_feedback', f.id, f.memberId, { programId: f.programId }), type: TRAINING_FEEDBACK_LEFT, payload: { feedbackId: f.id, programId: f.programId, programVersion: f.programVersion, exerciseId: f.exerciseId, reason: f.reason } }] })
}
export function decideAnswerFeedback(ctx: DecideContext, f: TrainingFeedback, reply: string): Result<{ next: TrainingFeedback; events: NewEvent[] }, DomainError> {
  if (reply.trim().length === 0) return err({ code: 'note_required' })
  const next: TrainingFeedback = { ...f, trainerReply: reply, status: 'answered', answeredAt: ctx.now }
  return ok({ next, events: [{ ...base(ctx, 'training_feedback', f.id, f.memberId, { programId: f.programId }), type: TRAINING_FEEDBACK_ANSWERED, payload: { feedbackId: f.id } }] })
}
export function decideResolveFeedback(ctx: DecideContext, f: TrainingFeedback): { next: TrainingFeedback; events: NewEvent[] } {
  const next: TrainingFeedback = { ...f, status: 'resolved' }
  return { next, events: [{ ...base(ctx, 'training_feedback', f.id, f.memberId, { programId: f.programId }), type: TRAINING_FEEDBACK_RESOLVED, payload: { feedbackId: f.id } }] }
}

// ── Exercise library (studio-scoped; version bumps on edit) ──
export function decideUpsertExercise(ctx: DecideContext, ex: Exercise, created: boolean): { next: Exercise; events: NewEvent[] } {
  return { next: ex, events: [{ ...base(ctx, 'exercise', ex.id, ex.studioId), type: EXERCISE_UPSERTED, payload: { exerciseId: ex.id, version: ex.version, created } }] }
}

// ── Progress photos — the URL/path never enters the event (§2). ──
export function decideAddPhoto(ctx: DecideContext, photo: ProgressPhoto): { next: ProgressPhoto; events: NewEvent[] } {
  return { next: photo, events: [{ ...base(ctx, 'member', photo.memberId, photo.memberId), type: PROGRESS_PHOTO_ADDED, payload: { photoId: photo.id, angle: photo.angle, takenOn: photo.takenOn } }] }
}
export function decideRemovePhoto(ctx: DecideContext, photo: ProgressPhoto, reason: string): Result<NewEvent[], DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  return ok([{ ...base(ctx, 'member', photo.memberId, photo.memberId), type: PROGRESS_PHOTO_REMOVED, payload: { photoId: photo.id, reason, at: ctx.now } }])
}
