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
  ReservationPolicyRef,
  ReservationStatus,
} from './domain/types'
export * from './events'
export { isBookable, selectEntitlement } from './domain/select-entitlement'
export { bookReservation, type BookReservationInput } from './application/book'
export { cancelReservation, type CancelReservationInput } from './application/cancel'
export type {
  BookDecision,
  BookTxInput,
  CancelDecision,
  CancelTxInput,
  ReservationRepository,
  ReservationsDeps,
} from './application/ports'
export { FirestoreReservationRepository } from './infrastructure/repos'
