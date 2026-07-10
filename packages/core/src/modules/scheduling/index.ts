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
  type CreateTemplateInput,
} from './application/template'
export {
  cancelSession,
  changeTrainer,
  generateSessions,
  scheduleSession,
  type ScheduleSessionInput,
} from './application/session'
export type { SchedulingDeps, SchedulingRepository } from './application/ports'
export { FirestoreSchedulingRepository } from './infrastructure/repos'
