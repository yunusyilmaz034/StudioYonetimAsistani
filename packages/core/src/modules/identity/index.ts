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
// Turnikeden mesai (owner, 2026-09-13 · OR-74): ilk geçiş açar, gece işi son geçişe kapatır.
export { closeShiftsAtLastCrossing, commitStaffCrossing, prepareStaffCrossing } from './application/staff-crossing'
export type { StaffCrossingDecision, StaffCrossingInput } from './domain/decide'
export {
  decideChangeRole,
  decideCloseShiftAtLastCrossing,
  decideCreateStaff,
  decideDeactivateStaff,
  decideEndShift,
  decideReactivateStaff,
  decideStaffCrossing,
  decideStartShift,
} from './domain/decide'
export * from './events'

// ── İzin / yokluk (owner onayı, 2026-09-11). Eklenen şey izin BAKİYESİ değil YOKLUKTUR: takvimde
//    hangi derslerin sahipsiz kalacağını söyleyen kayıt. Gerekçesi `events.ts`te. ──
export { requestStaffLeave, decideStaffLeave, cancelStaffLeave } from './application/leave'
export type { StaffLeaveDeps, StaffLeaveRepository } from './application/ports'
export type { StaffLeave } from './domain/types'
export { FirestoreStaffLeaveRepository } from './infrastructure/repos'
