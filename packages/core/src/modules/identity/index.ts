// The identity module's only public door (AD-29). Read-only in Phase 1: a staff /
// trainer list for the scheduling pickers. Staff creation with events is a later
// milestone; nothing here mutates state.
export type { StaffMember, StaffShift } from './domain/types'
export type { IdentityDeps, IdentityRepository, StaffShiftDeps, StaffShiftRepository } from './application/ports'
export { FirestoreIdentityRepository, FirestoreStaffShiftRepository } from './infrastructure/repos'
export {
  changeStaffRole,
  createStaff,
  deactivateStaff,
  reactivateStaff,
} from './application/staff'
export { endShift, startShift } from './application/shift'
export {
  decideChangeRole,
  decideCreateStaff,
  decideDeactivateStaff,
  decideEndShift,
  decideReactivateStaff,
  decideStartShift,
} from './domain/decide'
export * from './events'
