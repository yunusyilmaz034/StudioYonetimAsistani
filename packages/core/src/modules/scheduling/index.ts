// The scheduling module's only public door (AD-29).
export type {
  ClassSession,
  ClassSessionStatus,
  ClassTemplate,
  Room,
  ServicePolicyRef,
  SchedulingPolicy,
  Service,
  SessionCancellation,
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
export {
  cancelSession,
  changeCapacity,
  changeRoom,
  changeTrainer,
  generateSessions,
  scheduleSession,
  type ScheduleSessionInput,
} from './application/session'
export type { SchedulingDeps, SchedulingRepository } from './application/ports'
export { FirestoreSchedulingRepository } from './infrastructure/repos'
// Exposed for cross-aggregate transactions (the booking transaction reads and
// updates a session inside the same transaction as the reservation and credit).
export { sessionFromFirestore, sessionToFirestore } from './infrastructure/mappers'
