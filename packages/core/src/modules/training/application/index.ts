import {
  newCorrelationId,
  newExerciseId,
  newMeasurementId,
  newProgramId,
  newProgramTemplateId,
  newProgressPhotoId,
  newTrainingFeedbackId,
  ok,
  type ActorRef,
  type DomainError,
  type EventSource,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideAddPhoto,
  decideAnswerFeedback,
  decideChangeProgramStatus,
  decideCreateProgram,
  decideLeaveFeedback,
  decidePublishVersion,
  decideRecordMeasurement,
  decideRemovePhoto,
  decideResolveFeedback,
  decideUpsertExercise,
  type DecideContext,
} from '../domain/decide'
import type {
  Exercise,
  FeedbackReason,
  Measurement,
  PhotoAngle,
  Program,
  ProgramDay,
  ProgramExercise,
  ProgramStatus,
  ProgramTemplate,
  ProgramTemplateDay,
  ProgressPhoto,
  TemplateLevel,
  TrainingFeedback,
} from '../domain/types'
import type { TrainingDeps } from './ports'

export type { TrainingDeps, TrainingRepository } from './ports'

function dctx(deps: TrainingDeps, ctx: TenantContext, source: EventSource): DecideContext {
  return { studioId: ctx.studioId, actor: ctx.actor, now: deps.clock.now(), correlationId: newCorrelationId(), source }
}

// ── Exercise library ──
export interface UpsertExerciseInput {
  readonly id?: string | undefined
  readonly nameTr: string
  readonly nameEn?: string | undefined
  readonly description?: string | undefined
  readonly muscleGroup?: string | undefined
  readonly equipment?: string | undefined
  readonly photoUrl?: string | null | undefined
  readonly gifUrl?: string | null | undefined
  readonly videoUrl?: string | null | undefined
  readonly tips?: string | undefined
  readonly commonMistakes?: string | undefined
  readonly alternativeExerciseIds?: readonly string[] | undefined
  readonly active?: boolean | undefined
}

export async function upsertExercise(deps: TrainingDeps, ctx: TenantContext, input: UpsertExerciseInput, source: EventSource): Promise<Result<Exercise, DomainError>> {
  const existing = input.id ? await deps.repo.getExercise(ctx, input.id) : null
  const created = existing === null
  const dc = dctx(deps, ctx, source)
  const exercise: Exercise = {
    id: existing?.id ?? input.id ?? newExerciseId(),
    studioId: ctx.studioId,
    nameTr: input.nameTr,
    nameEn: input.nameEn ?? existing?.nameEn ?? '',
    description: input.description ?? existing?.description ?? '',
    muscleGroup: input.muscleGroup ?? existing?.muscleGroup ?? '',
    equipment: input.equipment ?? existing?.equipment ?? '',
    photoUrl: input.photoUrl ?? existing?.photoUrl ?? null,
    gifUrl: input.gifUrl ?? existing?.gifUrl ?? null,
    videoUrl: input.videoUrl ?? existing?.videoUrl ?? null,
    tips: input.tips ?? existing?.tips ?? '',
    commonMistakes: input.commonMistakes ?? existing?.commonMistakes ?? '',
    alternativeExerciseIds: input.alternativeExerciseIds ?? existing?.alternativeExerciseIds ?? [],
    active: input.active ?? existing?.active ?? true,
    version: (existing?.version ?? 0) + 1,
    updatedBy: actorId(dc.actor),
    updatedAt: dc.now,
  }
  const { next, events } = decideUpsertExercise(dc, exercise, created)
  await deps.repo.saveExercise(ctx, next, events)
  return ok(next)
}

export async function deactivateExercise(deps: TrainingDeps, ctx: TenantContext, id: string, active: boolean, source: EventSource): Promise<Result<Exercise, DomainError>> {
  const existing = await deps.repo.getExercise(ctx, id)
  if (!existing) return { ok: false, error: { code: 'name_required' } }
  return upsertExercise(deps, ctx, { ...existing, id, active }, source)
}

// ── Programmes ──
export interface CreateProgramInput {
  readonly memberId: string
  readonly trainerId: string
  readonly title: string
  readonly startsOn?: string | null | undefined
  readonly endsOn?: string | null | undefined
}

export async function createProgram(deps: TrainingDeps, ctx: TenantContext, input: CreateProgramInput, source: EventSource): Promise<Result<Program, DomainError>> {
  const dc = dctx(deps, ctx, source)
  const program: Program = {
    id: newProgramId(),
    studioId: ctx.studioId,
    memberId: input.memberId,
    trainerId: input.trainerId,
    title: input.title,
    status: 'draft',
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
    currentVersion: 0,
    versions: [],
    createdAt: dc.now,
    updatedAt: dc.now,
  }
  const r = decideCreateProgram(dc, program)
  if (!r.ok) return r
  await deps.repo.saveProgram(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

// A day the trainer authored: references to library exercises + her prescription. The library snapshot
// (name/media/description) is filled here at publish time so a later library edit never rewrites it.
export interface DraftProgramExercise {
  readonly exerciseId: string
  readonly order: number
  readonly sets: number
  readonly reps: string
  readonly restSeconds: number
  readonly tempo: string
  readonly note: string
  readonly alternativeExerciseId: string | null
}
export interface DraftProgramDay {
  readonly order: number
  readonly name: string
  readonly exercises: readonly DraftProgramExercise[]
}

export async function publishProgramVersion(
  deps: TrainingDeps,
  ctx: TenantContext,
  input: { readonly programId: string; readonly days: readonly DraftProgramDay[]; readonly note: string },
  source: EventSource,
): Promise<Result<Program, DomainError>> {
  const program = await deps.repo.getProgram(ctx, input.programId)
  if (!program) return { ok: false, error: { code: 'note_required' } }

  const library = await deps.repo.listExercises(ctx)
  const byId = new Map(library.map((e) => [e.id, e]))
  const days: ProgramDay[] = input.days.map((d) => ({
    order: d.order,
    name: d.name,
    exercises: d.exercises.map((x): ProgramExercise => {
      const lib = byId.get(x.exerciseId)
      return {
        exerciseId: x.exerciseId,
        order: x.order,
        nameTr: lib?.nameTr ?? '',
        videoUrl: lib?.videoUrl ?? null,
        description: lib?.description ?? '',
        sets: x.sets,
        reps: x.reps,
        restSeconds: x.restSeconds,
        tempo: x.tempo,
        note: x.note,
        alternativeExerciseId: x.alternativeExerciseId,
      }
    }),
  }))

  const dc = dctx(deps, ctx, source)
  const r = decidePublishVersion(dc, program, days, input.note)
  if (!r.ok) return r
  await deps.repo.saveProgram(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

export async function changeProgramStatus(deps: TrainingDeps, ctx: TenantContext, programId: string, to: ProgramStatus, source: EventSource): Promise<Result<Program, DomainError>> {
  const program = await deps.repo.getProgram(ctx, programId)
  if (!program) return { ok: false, error: { code: 'note_required' } }
  const dc = dctx(deps, ctx, source)
  const r = decideChangeProgramStatus(dc, program, to)
  if (!r.ok) return r
  await deps.repo.saveProgram(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

// ── Measurements ──
export interface MeasurementInput {
  readonly memberId: string
  readonly takenOn: string
  readonly weightKg?: number | null | undefined
  readonly fatPercent?: number | null | undefined
  readonly musclePercent?: number | null | undefined
  readonly waterPercent?: number | null | undefined
  readonly bmi?: number | null | undefined
  readonly bmr?: number | null | undefined
  readonly visceralFat?: number | null | undefined
  readonly circumferences?: Readonly<Record<string, number>> | undefined
  readonly note?: string | undefined
  readonly correctedFrom?: string | null | undefined
}

function buildMeasurement(ctx: TenantContext, dc: DecideContext, input: MeasurementInput): Measurement {
  return {
    id: newMeasurementId(),
    studioId: ctx.studioId,
    memberId: input.memberId,
    takenOn: input.takenOn,
    weightKg: input.weightKg ?? null,
    fatPercent: input.fatPercent ?? null,
    musclePercent: input.musclePercent ?? null,
    waterPercent: input.waterPercent ?? null,
    bmi: input.bmi ?? null,
    bmr: input.bmr ?? null,
    visceralFat: input.visceralFat ?? null,
    circumferences: input.circumferences ?? {},
    note: input.note ?? '',
    correctedFrom: input.correctedFrom ?? null,
    recordedBy: dc.actor,
    recordedAt: dc.now,
  }
}

export async function recordMeasurement(deps: TrainingDeps, ctx: TenantContext, input: MeasurementInput, source: EventSource): Promise<Result<Measurement, DomainError>> {
  const dc = dctx(deps, ctx, source)
  const { next, events } = decideRecordMeasurement(dc, buildMeasurement(ctx, dc, { ...input, correctedFrom: null }))
  await deps.repo.saveMeasurement(ctx, next, events)
  return ok(next)
}

export async function correctMeasurement(deps: TrainingDeps, ctx: TenantContext, input: MeasurementInput & { correctedFrom: string }, source: EventSource): Promise<Result<Measurement, DomainError>> {
  const dc = dctx(deps, ctx, source)
  const { next, events } = decideRecordMeasurement(dc, buildMeasurement(ctx, dc, input))
  await deps.repo.saveMeasurement(ctx, next, events)
  return ok(next)
}

// ── Feedback ──
export interface LeaveFeedbackInput {
  readonly memberId: string
  readonly programId: string
  readonly programVersion: number
  readonly dayOrder: number
  readonly exerciseId: string
  readonly reason: FeedbackReason
  readonly message: string
}

export async function leaveFeedback(deps: TrainingDeps, ctx: TenantContext, input: LeaveFeedbackInput, source: EventSource): Promise<Result<TrainingFeedback, DomainError>> {
  const dc = dctx(deps, ctx, source)
  const feedback: TrainingFeedback = {
    id: newTrainingFeedbackId(),
    studioId: ctx.studioId,
    memberId: input.memberId,
    programId: input.programId,
    programVersion: input.programVersion,
    dayOrder: input.dayOrder,
    exerciseId: input.exerciseId,
    reason: input.reason,
    message: input.message,
    trainerReply: null,
    status: 'open',
    createdAt: dc.now,
    answeredAt: null,
  }
  const r = decideLeaveFeedback(dc, feedback)
  if (!r.ok) return r
  await deps.repo.saveFeedback(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

export async function answerFeedback(deps: TrainingDeps, ctx: TenantContext, feedbackId: string, reply: string, source: EventSource): Promise<Result<TrainingFeedback, DomainError>> {
  const f = await deps.repo.getFeedback(ctx, feedbackId)
  if (!f) return { ok: false, error: { code: 'note_required' } }
  const dc = dctx(deps, ctx, source)
  const r = decideAnswerFeedback(dc, f, reply)
  if (!r.ok) return r
  await deps.repo.saveFeedback(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

export async function resolveFeedback(deps: TrainingDeps, ctx: TenantContext, feedbackId: string, source: EventSource): Promise<Result<TrainingFeedback, DomainError>> {
  const f = await deps.repo.getFeedback(ctx, feedbackId)
  if (!f) return { ok: false, error: { code: 'note_required' } }
  const dc = dctx(deps, ctx, source)
  const { next, events } = decideResolveFeedback(dc, f)
  await deps.repo.saveFeedback(ctx, next, events)
  return ok(next)
}

// ── Progress photos ──
export interface AddPhotoInput {
  readonly memberId: string
  readonly takenOn: string
  readonly angle: PhotoAngle
  readonly storagePath: string
  readonly note?: string | undefined
  readonly memberVisible?: boolean | undefined
}

export async function addPhoto(deps: TrainingDeps, ctx: TenantContext, input: AddPhotoInput, source: EventSource): Promise<Result<ProgressPhoto, DomainError>> {
  const dc = dctx(deps, ctx, source)
  const photo: ProgressPhoto = {
    id: newProgressPhotoId(),
    studioId: ctx.studioId,
    memberId: input.memberId,
    takenOn: input.takenOn,
    angle: input.angle,
    storagePath: input.storagePath,
    note: input.note ?? '',
    memberVisible: input.memberVisible ?? false,
    uploadedBy: dc.actor,
    uploadedAt: dc.now,
  }
  const { next, events } = decideAddPhoto(dc, photo)
  await deps.repo.savePhoto(ctx, next, events)
  return ok(next)
}

export async function removePhoto(deps: TrainingDeps, ctx: TenantContext, photoId: string, reason: string, source: EventSource): Promise<Result<{ readonly storagePath: string }, DomainError>> {
  const photo = await deps.repo.getPhoto(ctx, photoId)
  if (!photo) return { ok: false, error: { code: 'reason_required' } }
  const dc = dctx(deps, ctx, source)
  const r = decideRemovePhoto(dc, photo, reason)
  if (!r.ok) return r
  await deps.repo.deletePhoto(ctx, photoId, r.value)
  return ok({ storagePath: photo.storagePath })
}

// ── Program templates (CONFIG — no events; assigning one to a member IS event-sourced) ──
export interface TemplateExerciseInput {
  readonly exerciseId: string
  readonly order: number
  readonly sets: number
  readonly reps: string
  readonly restSeconds?: number | undefined
  readonly tempo?: string | undefined
  readonly note?: string | undefined
  readonly alternativeExerciseId?: string | null | undefined
}
export interface TemplateDayInput {
  readonly order: number
  readonly name: string
  readonly exercises: readonly TemplateExerciseInput[]
}
export interface UpsertTemplateInput {
  readonly id?: string | undefined
  readonly name: string
  readonly level: TemplateLevel
  readonly description?: string | undefined
  readonly days: readonly TemplateDayInput[]
}

export async function upsertProgramTemplate(deps: TrainingDeps, ctx: TenantContext, input: UpsertTemplateInput, source: EventSource): Promise<Result<ProgramTemplate, DomainError>> {
  if (input.name.trim().length === 0) return { ok: false, error: { code: 'template_name_required' } }
  if (input.days.length === 0 || input.days.some((d) => d.exercises.length === 0)) return { ok: false, error: { code: 'template_empty' } }
  if (input.days.some((d) => d.exercises.some((x) => x.sets < 1 || x.reps.trim().length === 0))) return { ok: false, error: { code: 'template_empty' } }

  const dc = dctx(deps, ctx, source)
  // Resolve each exercise's current library name so the template shows real names in its own list.
  const library = await deps.repo.listExercises(ctx)
  const nameById = new Map(library.map((e) => [e.id, e.nameTr]))
  const days: readonly ProgramTemplateDay[] = input.days.map((d) => ({
    order: d.order,
    name: d.name,
    exercises: d.exercises.map((x) => ({
      exerciseId: x.exerciseId,
      order: x.order,
      nameTr: nameById.get(x.exerciseId) ?? '',
      sets: x.sets,
      reps: x.reps,
      restSeconds: x.restSeconds ?? 60,
      tempo: x.tempo ?? '',
      note: x.note ?? '',
      alternativeExerciseId: x.alternativeExerciseId ?? null,
    })),
  }))
  const existing = input.id ? await deps.repo.getTemplate(ctx, input.id) : null
  const template: ProgramTemplate = {
    id: existing?.id ?? input.id ?? newProgramTemplateId(),
    studioId: ctx.studioId,
    name: input.name.trim(),
    level: input.level,
    description: input.description ?? existing?.description ?? '',
    days,
    active: existing?.active ?? true,
    updatedBy: actorId(dc.actor),
    updatedAt: dc.now,
  }
  await deps.repo.saveTemplate(ctx, template)
  return ok(template)
}

export async function listProgramTemplates(deps: TrainingDeps, ctx: TenantContext): Promise<readonly ProgramTemplate[]> {
  return deps.repo.listTemplates(ctx)
}
export async function getProgramTemplate(deps: TrainingDeps, ctx: TenantContext, id: string): Promise<ProgramTemplate | null> {
  return deps.repo.getTemplate(ctx, id)
}
export async function deleteProgramTemplate(deps: TrainingDeps, ctx: TenantContext, id: string): Promise<Result<{ readonly id: string }, DomainError>> {
  const existing = await deps.repo.getTemplate(ctx, id)
  if (!existing) return { ok: false, error: { code: 'template_not_found_pt' } }
  await deps.repo.deleteTemplate(ctx, id)
  return ok({ id })
}

export interface AssignTemplateInput {
  readonly templateId: string
  readonly memberId: string
  readonly trainerId: string
  readonly title?: string | undefined
}
// Instantiate a template onto a member — the ONLY event-emitting path here: it creates a real
// programme (createProgram) and publishes v1 from the template's days (publishProgramVersion, which
// snapshots the library). A later edit to the template never touches the member's published programme.
export async function instantiateTemplate(deps: TrainingDeps, ctx: TenantContext, input: AssignTemplateInput, source: EventSource): Promise<Result<Program, DomainError>> {
  const template = await deps.repo.getTemplate(ctx, input.templateId)
  if (!template) return { ok: false, error: { code: 'template_not_found_pt' } }

  const created = await createProgram(deps, ctx, {
    memberId: input.memberId,
    trainerId: input.trainerId,
    title: input.title ?? template.name,
  }, source)
  if (!created.ok) return created

  const days: readonly DraftProgramDay[] = template.days.map((d) => ({
    order: d.order,
    name: d.name,
    exercises: d.exercises.map((x): DraftProgramExercise => ({
      exerciseId: x.exerciseId,
      order: x.order,
      sets: x.sets,
      reps: x.reps,
      restSeconds: x.restSeconds,
      tempo: x.tempo,
      note: x.note,
      alternativeExerciseId: x.alternativeExerciseId,
    })),
  }))
  return publishProgramVersion(deps, ctx, { programId: created.value.id, days, note: `Şablon: ${template.name}` }, source)
}

function actorId(actor: ActorRef): string {
  const a = actor as unknown as { id?: string }
  return typeof a.id === 'string' ? a.id : 'system'
}
