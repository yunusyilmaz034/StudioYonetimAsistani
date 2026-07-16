import type { Clock, NewEvent, TenantContext } from '../../../shared'
import type { Exercise, Measurement, Program, ProgramTemplate, ProgressPhoto, TrainingFeedback } from '../domain/types'

// The training repository port. Infrastructure (FirestoreTrainingRepository) implements it; the
// application composes the pure deciders against it. State + events always commit together (#1).
export interface TrainingRepository {
  getExercise(ctx: TenantContext, id: string): Promise<Exercise | null>
  listExercises(ctx: TenantContext): Promise<readonly Exercise[]>
  saveExercise(ctx: TenantContext, exercise: Exercise, events: readonly NewEvent[]): Promise<void>

  getProgram(ctx: TenantContext, id: string): Promise<Program | null>
  listProgramsByMember(ctx: TenantContext, memberId: string): Promise<readonly Program[]>
  listProgramsByTrainer(ctx: TenantContext, trainerId: string): Promise<readonly Program[]>
  saveProgram(ctx: TenantContext, program: Program, events: readonly NewEvent[]): Promise<void>

  listMeasurementsByMember(ctx: TenantContext, memberId: string): Promise<readonly Measurement[]>
  saveMeasurement(ctx: TenantContext, measurement: Measurement, events: readonly NewEvent[]): Promise<void>

  getFeedback(ctx: TenantContext, id: string): Promise<TrainingFeedback | null>
  listFeedbackByMember(ctx: TenantContext, memberId: string): Promise<readonly TrainingFeedback[]>
  listOpenFeedback(ctx: TenantContext): Promise<readonly TrainingFeedback[]>
  saveFeedback(ctx: TenantContext, feedback: TrainingFeedback, events: readonly NewEvent[]): Promise<void>

  getPhoto(ctx: TenantContext, id: string): Promise<ProgressPhoto | null>
  listPhotosByMember(ctx: TenantContext, memberId: string): Promise<readonly ProgressPhoto[]>
  savePhoto(ctx: TenantContext, photo: ProgressPhoto, events: readonly NewEvent[]): Promise<void>
  deletePhoto(ctx: TenantContext, id: string, events: readonly NewEvent[]): Promise<void>

  // Program templates — CONFIG, no events.
  getTemplate(ctx: TenantContext, id: string): Promise<ProgramTemplate | null>
  listTemplates(ctx: TenantContext): Promise<readonly ProgramTemplate[]>
  saveTemplate(ctx: TenantContext, template: ProgramTemplate): Promise<void>
  deleteTemplate(ctx: TenantContext, id: string): Promise<void>
}

export interface TrainingDeps {
  readonly repo: TrainingRepository
  readonly clock: Clock
}
