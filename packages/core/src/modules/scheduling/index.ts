// The scheduling module's only public door (AD-29).
export type {
  CancellationWindowSource,
  ClassSession,
  ClassSessionStatus,
  ClassTemplate,
  NoteVisibility,
  Room,
  ServicePolicyRef,
  SchedulingPolicy,
  Service,
  SessionCancellation,
  SessionNote,
  SessionPolicySnapshot,
  StudioSettings,
  Weekday,
} from './domain/types'
export * from './events'
export {
  createService,
  deactivateService,
  publishServicePolicy,
  reactivateService,
  updateService,
  type CreateServiceInput,
} from './application/service'
export {
  createRoom,
  deactivateRoom,
  reactivateRoom,
  updateRoom,
  type CreateRoomInput,
} from './application/room'
export {
  createTemplate,
  deactivateTemplate,
  updateTemplate,
  type CreateTemplateInput,
  type UpdateTemplateInput,
} from './application/template'
export { resolveCancellationWindow } from './domain/cancellation-window'
export {
  assignSessionMember,
  cancelSession,
  changeCapacity,
  changeRoom,
  changeTrainer,
  generateSessions,
  scheduleSession,
  setSessionNote,
  setStudioDefaults,
  type ScheduleSessionInput,
} from './application/session'
// D13 — reading yesterday's event shape with today's types. The log is never rewritten.
export { upcastClassSessionScheduled } from './upcasters'
export {
  computeDuplicationPlan,
  planWeekDuplication,
  applyWeekDuplication,
  type DuplicateWeekInput,
  type DuplicationPlan,
  type DuplicationTarget,
} from './application/duplicate-week'
export type { SchedulingDeps, SchedulingRepository } from './application/ports'
export { FirestoreSchedulingRepository } from './infrastructure/repos'
// Exposed for cross-aggregate transactions (the booking transaction reads and
// updates a session inside the same transaction as the reservation and credit).
export { sessionFromFirestore, sessionToFirestore } from './infrastructure/mappers'
