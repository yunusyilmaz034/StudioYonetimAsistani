'use server'

import {
  addPhoto,
  answerFeedback,
  changeProgramStatus,
  correctMeasurement,
  createProgram,
  deactivateExercise,
  deleteProgramTemplate,
  FirestoreEntitlementRepository,
  FirestoreTrainingRepository,
  instantiateTemplate,
  leaveFeedback,
  listProgramTemplates,
  publishProgramVersion,
  recordMeasurement,
  removePhoto,
  resolveFeedback,
  systemClock,
  upsertExercise,
  upsertProgramTemplate,
  type TrainingDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { z } from 'zod'

import type { ExerciseGuide } from '@/components/exercise-guide-dialog'
import { ForbiddenError, requireMemberContext, requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'

// ── TRAINING & PROGRESS web actions (Plus Phase 7). Roles (§13): Owner all; Trainer her own members;
//    Reception sees only that a programme EXISTS (a boolean, never content, never a photo); Member her
//    own only. Progress photos are member PII — the file lives in a private bucket, a short-lived
//    signed URL is minted on read, nothing is ever public.
const TRAINER = ['owner', 'trainer', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const STAFF_SOURCE = 'reception_web'
const MEMBER_SOURCE = 'member_portal'
const READ_URL_TTL_MS = 5 * 60_000 // a signed READ url lives 5 minutes; never stored, minted per read

const trainingDeps = (): TrainingDeps => ({ repo: new FirestoreTrainingRepository(adminDb()), clock: systemClock })
const repo = () => new FirestoreTrainingRepository(adminDb())

function actorRef(ctx: TenantContext): { type: string; id: string } {
  return ctx.actor as unknown as { type: string; id: string }
}

// A trainer may act only on programmes she owns; the owner and platform_admin see all. Enforced after
// the load, because ownership is a property of the aggregate, not the request.
function assertTrainerOwns(ctx: TenantContext, trainerId: string): void {
  const a = actorRef(ctx)
  if (a.type === 'trainer' && trainerId !== a.id) throw new ForbiddenError([...TRAINER])
}

// Is this staff principal allowed to see this member's training CONTENT (programmes, measurements,
// photos)? Owner/platform_admin yes; a trainer only if she has a programme for the member.
async function assertMayReadMemberContent(ctx: TenantContext, memberId: string): Promise<void> {
  const a = actorRef(ctx)
  if (a.type === 'owner' || a.type === 'platform_admin') return
  if (a.type !== 'trainer') throw new ForbiddenError([...TRAINER])
  const programs = await repo().listProgramsByMember(ctx, memberId)
  if (!programs.some((p) => p.trainerId === a.id)) throw new ForbiddenError([...TRAINER])
}

// ── Exercise library ─────────────────────────────────────────────────────────────────────────
export async function listExercisesAction() {
  const ctx = await requireTenantContext(TRAINER)
  return repo().listExercises(ctx)
}

export async function upsertExerciseAction(input: unknown) {
  const p = z
    .object({
      id: z.string().optional(),
      nameTr: z.string().trim().min(1),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      muscleGroup: z.string().optional(),
      equipment: z.string().optional(),
      photoUrl: z.string().nullable().optional(),
      gifUrl: z.string().nullable().optional(),
      videoUrl: z.string().nullable().optional(),
      tips: z.string().optional(),
      commonMistakes: z.string().optional(),
      alternativeExerciseIds: z.array(z.string()).optional(),
      active: z.boolean().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(TRAINER)
  return upsertExercise(trainingDeps(), ctx, p, STAFF_SOURCE)
}

export async function deactivateExerciseAction(input: unknown) {
  const p = z.object({ id: z.string().min(1), active: z.boolean() }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  return deactivateExercise(trainingDeps(), ctx, p.id, p.active, STAFF_SOURCE)
}

// ── Programmes ───────────────────────────────────────────────────────────────────────────────
export async function createProgramAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      trainerId: z.string().optional(),
      title: z.string().trim().min(1),
      startsOn: z.string().nullable().optional(),
      endsOn: z.string().nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const a = actorRef(ctx)
  // A trainer always authors as herself; only the owner may assign another trainer.
  const trainerId = a.type === 'trainer' ? a.id : p.trainerId ?? a.id
  return createProgram(trainingDeps(), ctx, { ...p, trainerId }, STAFF_SOURCE)
}

const draftExercise = z.object({
  exerciseId: z.string().min(1),
  order: z.number().int(),
  sets: z.number().int().min(0),
  reps: z.string(),
  restSeconds: z.number().int().min(0),
  tempo: z.string(),
  note: z.string(),
  alternativeExerciseId: z.string().nullable(),
})

// ── Program templates (reusable skeletons; assigning one to a member creates her programme) ──────
export async function listProgramTemplatesAction() {
  const ctx = await requireTenantContext(TRAINER)
  return listProgramTemplates(trainingDeps(), ctx)
}

export async function getProgramTemplateAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  return trainingDeps().repo.getTemplate(ctx, p.id)
}

const templateExercise = z.object({
  exerciseId: z.string().min(1),
  order: z.number().int(),
  sets: z.number().int().min(1),
  reps: z.string().trim().min(1),
  restSeconds: z.number().int().min(0).optional(),
  tempo: z.string().optional(),
  note: z.string().optional(),
  alternativeExerciseId: z.string().nullable().optional(),
})

export async function upsertProgramTemplateAction(input: unknown) {
  const p = z
    .object({
      id: z.string().optional(),
      name: z.string().trim().min(1),
      level: z.enum(['beginner', 'intermediate', 'advanced']),
      description: z.string().optional(),
      days: z.array(z.object({ order: z.number().int(), name: z.string(), exercises: z.array(templateExercise).min(1) })).min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(TRAINER)
  return upsertProgramTemplate(trainingDeps(), ctx, p, STAFF_SOURCE)
}

export async function deleteProgramTemplateAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  return deleteProgramTemplate(trainingDeps(), ctx, p.id)
}

// Assign a template TO a member → creates her programme (event-sourced). Trainer authors as herself.
export async function assignTemplateAction(input: unknown) {
  const p = z.object({ templateId: z.string().min(1), memberId: z.string().min(1), trainerId: z.string().optional() }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const a = actorRef(ctx)
  const trainerId = a.type === 'trainer' ? a.id : p.trainerId ?? a.id
  await assertMayReadMemberContent(ctx, p.memberId)
  return instantiateTemplate(trainingDeps(), ctx, { templateId: p.templateId, memberId: p.memberId, trainerId }, STAFF_SOURCE)
}

export async function publishProgramVersionAction(input: unknown) {
  const p = z
    .object({
      programId: z.string().min(1),
      days: z.array(z.object({ order: z.number().int(), name: z.string(), exercises: z.array(draftExercise) })).min(1),
      note: z.string().default(''),
    })
    .parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const program = await repo().getProgram(ctx, p.programId)
  if (!program) return { ok: false as const, error: { code: 'note_required' as const } }
  assertTrainerOwns(ctx, program.trainerId)
  return publishProgramVersion(trainingDeps(), ctx, p, STAFF_SOURCE)
}

export async function changeProgramStatusAction(input: unknown) {
  const p = z.object({ programId: z.string().min(1), to: z.enum(['draft', 'active', 'completed', 'archived']) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const program = await repo().getProgram(ctx, p.programId)
  if (!program) return { ok: false as const, error: { code: 'note_required' as const } }
  assertTrainerOwns(ctx, program.trainerId)
  return changeProgramStatus(trainingDeps(), ctx, p.programId, p.to, STAFF_SOURCE)
}

export async function getProgramAction(input: unknown) {
  const p = z.object({ programId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const program = await repo().getProgram(ctx, p.programId)
  if (!program) return null
  assertTrainerOwns(ctx, program.trainerId)
  return program
}

// PF-34 — make ONE programme the member's active one. A member follows a single programme at a time, so
// activating a new one RETIRES any currently-active sibling to 'draft' (the reversible passive state —
// 'archived' is terminal and never used here). This is also what PF-35's AI builder leans on ("aktif yap,
// varsa eskileri pasife al").
export async function setActiveProgramAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1), programId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const target = await repo().getProgram(ctx, p.programId)
  if (!target) return { ok: false as const, error: { code: 'note_required' as const } }
  assertTrainerOwns(ctx, target.trainerId)

  const a = actorRef(ctx)
  const siblings = await repo().listProgramsByMember(ctx, p.memberId)
  for (const prog of siblings) {
    // Only retire ACTIVE siblings the actor may touch (a trainer edits only her own; owner/admin all).
    if (prog.id === p.programId || prog.status !== 'active') continue
    if (a.type === 'trainer' && prog.trainerId !== a.id) continue
    await changeProgramStatus(trainingDeps(), ctx, prog.id, 'draft', STAFF_SOURCE)
  }
  return changeProgramStatus(trainingDeps(), ctx, p.programId, 'active', STAFF_SOURCE)
}

export async function listMemberProgramsAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const a = actorRef(ctx)
  const programs = await repo().listProgramsByMember(ctx, p.memberId)
  // A trainer sees only the programmes she owns for this member; owner/platform_admin see all.
  return a.type === 'trainer' ? programs.filter((prog) => prog.trainerId === a.id) : programs
}

// Reception's boolean-only view: DOES a programme exist / is one active — never its content (§13).
export async function memberProgramStatusAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const programs = await repo().listProgramsByMember(ctx, p.memberId)
  return {
    hasProgram: programs.length > 0,
    hasActive: programs.some((prog) => prog.status === 'active'),
    hasExpired: programs.some((prog) => prog.status === 'completed' || prog.status === 'archived'),
  }
}

// ── Measurements ─────────────────────────────────────────────────────────────────────────────
const measurementFields = {
  memberId: z.string().min(1),
  takenOn: z.string().min(1),
  weightKg: z.number().nullable().optional(),
  fatPercent: z.number().nullable().optional(),
  musclePercent: z.number().nullable().optional(),
  waterPercent: z.number().nullable().optional(),
  bmi: z.number().nullable().optional(),
  bmr: z.number().nullable().optional(),
  visceralFat: z.number().nullable().optional(),
  circumferences: z.record(z.string(), z.number()).optional(),
  note: z.string().optional(),
}

export async function recordMeasurementAction(input: unknown) {
  const p = z.object(measurementFields).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  await assertMayReadMemberContent(ctx, p.memberId)
  return recordMeasurement(trainingDeps(), ctx, p, STAFF_SOURCE)
}

export async function correctMeasurementAction(input: unknown) {
  const p = z.object({ ...measurementFields, correctedFrom: z.string().min(1), note: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  await assertMayReadMemberContent(ctx, p.memberId)
  return correctMeasurement(trainingDeps(), ctx, p, STAFF_SOURCE)
}

export async function listMemberMeasurementsAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  await assertMayReadMemberContent(ctx, p.memberId)
  return repo().listMeasurementsByMember(ctx, p.memberId)
}

// ── Feedback ─────────────────────────────────────────────────────────────────────────────────
export async function leaveFeedbackAction(input: unknown) {
  const { ctx, memberId } = await requireMemberContext()
  return leaveOwnFeedback(ctx, memberId, input)
}

// ctx-taking core, shared by the cookie Server Action and the Bearer member API (mobile app).
export async function leaveOwnFeedback(ctx: TenantContext, memberId: MemberId, input: unknown) {
  const p = z
    .object({
      programId: z.string().min(1),
      programVersion: z.number().int(),
      dayOrder: z.number().int(),
      exerciseId: z.string().min(1),
      reason: z.enum(['pain', 'too_easy', 'too_hard', 'not_felt', 'machine_busy', 'video_unclear', 'other']),
      message: z.string().trim().min(1),
    })
    .parse(input)
  // A member leaves feedback only on HER OWN programme.
  const program = await repo().getProgram(ctx, p.programId)
  if (!program || program.memberId !== memberId) return { ok: false as const, error: { code: 'note_required' as const } }
  return leaveFeedback(trainingDeps(), ctx, { ...p, memberId }, MEMBER_SOURCE)
}

export async function answerFeedbackAction(input: unknown) {
  const p = z.object({ feedbackId: z.string().min(1), reply: z.string().trim().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  return answerFeedback(trainingDeps(), ctx, p.feedbackId, p.reply, STAFF_SOURCE)
}

export async function resolveFeedbackAction(input: unknown) {
  const p = z.object({ feedbackId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  return resolveFeedback(trainingDeps(), ctx, p.feedbackId, STAFF_SOURCE)
}

export async function listOpenFeedbackAction() {
  const ctx = await requireTenantContext(TRAINER)
  const a = actorRef(ctx)
  const open = await repo().listOpenFeedback(ctx)
  if (a.type !== 'trainer') return open
  // A trainer sees only feedback on her own programmes.
  const mine = await repo().listProgramsByTrainer(ctx, a.id)
  const ids = new Set(mine.map((prog) => prog.id))
  return open.filter((f) => ids.has(f.programId))
}

export async function listMemberFeedbackAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  await assertMayReadMemberContent(ctx, p.memberId)
  return repo().listFeedbackByMember(ctx, p.memberId)
}

// ── Progress photos (private Storage; signed URLs only) ───────────────────────────────────────
async function signedReadUrl(storagePath: string): Promise<string | null> {
  try {
    const [url] = await adminStorage()
      .bucket(storageBucketName())
      .file(storagePath)
      .getSignedUrl({ action: 'read', expires: systemClock.now() + READ_URL_TTL_MS })
    return url
  } catch {
    // No signing credentials (e.g. the emulator) — return no URL rather than a public one.
    return null
  }
}

// The client uploads the FILE directly to a rules-guarded private path via the Firebase client SDK;
// the server records only metadata. The path MUST live under this member's private prefix.
export async function addProgressPhotoAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      takenOn: z.string().min(1),
      angle: z.enum(['front', 'side', 'back']),
      storagePath: z.string().min(1),
      note: z.string().optional(),
      memberVisible: z.boolean().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(TRAINER)
  await assertMayReadMemberContent(ctx, p.memberId)
  const prefix = `studios/${ctx.studioId}/members/${p.memberId}/progress/`
  if (!p.storagePath.startsWith(prefix)) return { ok: false as const, error: { code: 'note_required' as const } }
  return addPhoto(trainingDeps(), ctx, p, STAFF_SOURCE)
}

export async function listMemberPhotosAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  await assertMayReadMemberContent(ctx, p.memberId)
  const photos = await repo().listPhotosByMember(ctx, p.memberId)
  return Promise.all(
    photos.map(async (photo) => ({
      id: photo.id,
      takenOn: photo.takenOn,
      angle: photo.angle,
      note: photo.note,
      memberVisible: photo.memberVisible,
      url: await signedReadUrl(photo.storagePath),
    })),
  )
}

export async function removeProgressPhotoAction(input: unknown) {
  const p = z.object({ photoId: z.string().min(1), reason: z.string().trim().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)
  const photo = await repo().getPhoto(ctx, p.photoId)
  if (!photo) return { ok: false as const, error: { code: 'reason_required' as const } }
  await assertMayReadMemberContent(ctx, photo.memberId)
  const r = await removePhoto(trainingDeps(), ctx, p.photoId, p.reason, STAFF_SOURCE)
  // Best-effort delete of the Storage object (the metadata + audit event already committed).
  if (r.ok) {
    try {
      await adminStorage().bucket(storageBucketName()).file(r.value.storagePath).delete({ ignoreNotFound: true })
    } catch {
      /* the object may be cleaned up by a lifecycle rule; the audit event is the source of truth */
    }
  }
  return r.ok ? { ok: true as const } : r
}

// ── Member portal reads (memberId ALWAYS from the verified session — never a parameter) ────────

// Everything the training screen shows, in one ctx-taking call — shared by the cookie portal and the
// Bearer member API (the mobile app). Photos carry short-lived signed URLs; the raw path never leaves.
export async function loadMyTraining(ctx: TenantContext, memberId: MemberId) {
  const [programs, exercises, measurements, feedback, photos, entitlements] = await Promise.all([
    repo().listProgramsByMember(ctx, memberId),
    repo().listExercises(ctx),
    repo().listMeasurementsByMember(ctx, memberId),
    repo().listFeedbackByMember(ctx, memberId),
    repo().listPhotosByMember(ctx, memberId),
    new FirestoreEntitlementRepository(adminDb()).listActiveByMember(ctx, memberId),
  ])
  // Training PROGRAMMES are for members who actually train — fitness (gym) or PT. A pilates-only member
  // has no use for a workout plan; she sees only her measurements. Kept honest by a real membership
  // check, and a safety net: if a programme somehow exists, never hide it.
  const showPrograms =
    entitlements.some((e) => e.productSnapshot.category === 'fitness' || e.productSnapshot.category === 'private') ||
    programs.length > 0
  const used = new Set<string>()
  for (const p of programs) for (const v of p.versions) for (const day of v.days) for (const e of day.exercises) used.add(e.exerciseId)
  const guides: Record<string, ExerciseGuide> = {}
  for (const ex of exercises) {
    if (!used.has(ex.id)) continue
    guides[ex.id] = {
      nameTr: ex.nameTr,
      muscleGroup: ex.muscleGroup,
      equipment: ex.equipment,
      description: ex.description,
      tips: ex.tips,
      commonMistakes: ex.commonMistakes,
      videoUrl: ex.videoUrl,
      photoUrl: ex.photoUrl,
      gifUrl: ex.gifUrl,
    }
  }
  const visiblePhotos = await Promise.all(
    photos
      .filter((photo) => photo.memberVisible)
      .map(async (photo) => ({ id: photo.id, takenOn: photo.takenOn, angle: photo.angle, note: photo.note, url: await signedReadUrl(photo.storagePath) })),
  )
  return {
    programs,
    activeProgram: programs.find((p) => p.status === 'active') ?? null,
    guides,
    measurements,
    feedback,
    photos: visiblePhotos,
    showPrograms,
  }
}

export async function listMyProgramsAction() {
  const { ctx, memberId } = await requireMemberContext()
  return repo().listProgramsByMember(ctx, memberId)
}

// Training programmes are for members who train — fitness (gym) or PT. A pilates-only member sees only
// her measurements, so the portal hides the "Programım" tab. Safety net: never hide a programme that
// actually exists.
export async function showMyProgramsAction(): Promise<boolean> {
  const { ctx, memberId } = await requireMemberContext()
  const [programs, ents] = await Promise.all([
    repo().listProgramsByMember(ctx, memberId),
    new FirestoreEntitlementRepository(adminDb()).listActiveByMember(ctx, memberId),
  ])
  return ents.some((e) => e.productSnapshot.category === 'fitness' || e.productSnapshot.category === 'private') || programs.length > 0
}

// The guidance (Hareket Rehberi) for the exercises in HER programs — so the portal can show the guide
// (PF-11) next to each program exercise. Scoped to her own programs' exercises, never the whole library.
export async function listMyProgramGuidesAction(): Promise<Record<string, ExerciseGuide>> {
  const { ctx, memberId } = await requireMemberContext()
  const [programs, exercises] = await Promise.all([repo().listProgramsByMember(ctx, memberId), repo().listExercises(ctx)])
  const used = new Set<string>()
  for (const p of programs) for (const v of p.versions) for (const day of v.days) for (const e of day.exercises) used.add(e.exerciseId)
  const guides: Record<string, ExerciseGuide> = {}
  for (const ex of exercises) {
    if (!used.has(ex.id)) continue
    guides[ex.id] = {
      nameTr: ex.nameTr,
      muscleGroup: ex.muscleGroup,
      equipment: ex.equipment,
      description: ex.description,
      tips: ex.tips,
      commonMistakes: ex.commonMistakes,
      videoUrl: ex.videoUrl,
      photoUrl: ex.photoUrl,
      gifUrl: ex.gifUrl,
    }
  }
  return guides
}

export async function getMyActiveProgramAction() {
  const { ctx, memberId } = await requireMemberContext()
  const programs = await repo().listProgramsByMember(ctx, memberId)
  return programs.find((prog) => prog.status === 'active') ?? null
}

export async function listMyMeasurementsAction() {
  const { ctx, memberId } = await requireMemberContext()
  return repo().listMeasurementsByMember(ctx, memberId)
}

export async function listMyFeedbackAction() {
  const { ctx, memberId } = await requireMemberContext()
  return repo().listFeedbackByMember(ctx, memberId)
}

export async function listMyPhotosAction() {
  const { ctx, memberId } = await requireMemberContext()
  const photos = await repo().listPhotosByMember(ctx, memberId)
  return Promise.all(
    photos
      .filter((photo) => photo.memberVisible) // the member sees only what the trainer chose to share
      .map(async (photo) => ({
        id: photo.id,
        takenOn: photo.takenOn,
        angle: photo.angle,
        note: photo.note,
        url: await signedReadUrl(photo.storagePath),
      })),
  )
}
