// The reservations module's only public door (AD-29). It owns booking, cancellation,
// attendance, auto-resolution, and correction (Doc 2 §7), and invariants I-9, I-10,
// I-14, I-17, I-18. It sits on top of scheduling (sessions) and entitlements (the
// ledger), composing their deciders in its transactions (AD-53).
//
// The low-level deciders and DecideContext stay internal in Phase 1 (tests import
// them directly from ./domain/decide); their wiring for attendance/auto-resolve is
// the v1.10 Automation milestone.
export type {
  AttendanceSource,
  CreditEffect,
  Reservation,
  ReservationNote,
  ReservationPolicyRef,
  ReservationStatus,
} from './domain/types'
export * from './events'
export {
  ATTENDANCE_MARK,
  type AttendanceMarkPayload,
  type AttendanceMarkType,
  type AttendanceOutcome,
} from './commands'
export { isBookable, selectEntitlement } from './domain/select-entitlement'
export { bookReservation, type BookReservationInput } from './application/book'
export { cancelReservation, type CancelReservationInput } from './application/cancel'
export { moveReservation, type MoveReservationInput } from './application/move'
export {
  applyRecurring,
  previewRecurring,
  type RecurringDeps,
  type RecurringInputDto,
  type RecurringSummary,
  type RecurringWorld,
} from './application/recurring'
export {
  computeRecurringPlan,
  type RecurringPlan,
  type RecurringSkip,
  type RecurringSkipReason,
  type RecurringTarget,
} from './domain/recurring'
export { markAttendance, type MarkAttendanceInput } from './application/mark-attendance'
export {
  autoResolveReservation,
  sweepAutoResolve,
  type AutoResolveSummary,
} from './application/auto-resolve'
export { correctReservation, type CorrectReservationInput } from './application/correct'
export { setReservationNote, type SetReservationNoteInput } from './application/set-note'
export type {
  BookDecision,
  BookTxInput,
  CancelDecision,
  CancelTxInput,
  MoveDecision,
  MoveTxInput,
  ResolveDecision,
  ResolveTxInput,
  ReservationRepository,
  ReservationsDeps,
} from './application/ports'
export { FirestoreReservationRepository } from './infrastructure/repos'
