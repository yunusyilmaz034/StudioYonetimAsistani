// The training module's public door (Plus Phase 7 — Training & Progress). A programme is never
// edited (every change is a new VERSION); a version snapshots what it referenced; measurements and
// photos are member PII that never enter an event.
export type {
  Exercise,
  FeedbackReason,
  FeedbackStatus,
  Measurement,
  PhotoAngle,
  Program,
  ProgramDay,
  ProgramExercise,
  ProgramStatus,
  ProgramVersion,
  ProgressPhoto,
  TrainingFeedback,
} from './domain/types'
export { FeedbackReasons } from './domain/types'
export * from './events'
export {
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
  type DecideContext as TrainingDecideContext,
} from './domain/decide'
export { FirestoreTrainingRepository } from './infrastructure/repos'
export {
  addPhoto,
  answerFeedback,
  changeProgramStatus,
  createProgram,
  correctMeasurement,
  deactivateExercise,
  leaveFeedback,
  publishProgramVersion,
  recordMeasurement,
  removePhoto,
  resolveFeedback,
  upsertExercise,
  type AddPhotoInput,
  type CreateProgramInput,
  type DraftProgramDay,
  type DraftProgramExercise,
  type LeaveFeedbackInput,
  type MeasurementInput,
  type TrainingDeps,
  type TrainingRepository,
  type UpsertExerciseInput,
} from './application/index'
