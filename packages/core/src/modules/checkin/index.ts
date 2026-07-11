// The checkin module's only public door (AD-29). Check-in ≠ attendance (Doc 2 §9):
// walking through the door produces occupancy, not credit consumption. It owns the
// `/checkIns` log, the `/presence` toggle state, and the branch occupancy window.
export type {
  BranchOccupancy,
  CheckIn,
  CheckInDirection,
  CheckInMethod,
  Presence,
} from './domain/types'
export * from './events'
export {
  CHECKIN_RECORD,
  type CheckInRecordPayload,
  type CheckInRecordType,
} from './commands'
export { recordCheckIn, type RecordCheckInInput } from './application/checkin'
export { openBranch, closeBranch } from './application/branch'
export { sweepAutoCheckOut, type AutoCheckOutSummary } from './application/sweep'
export type { CheckinDeps, CheckinRepository } from './application/ports'
export { FirestoreCheckinRepository } from './infrastructure/repos'
