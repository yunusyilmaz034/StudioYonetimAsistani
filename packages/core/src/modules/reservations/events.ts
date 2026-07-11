import type { EntitlementId, Instant } from '../../shared'
import type { CreditEffect, ReservationStatus } from './domain/types'

// Reservation events (Doc 4 §"Reservation"). No PII (I-13) — the roster's
// memberSnapshot lives on the state document, never here. `hoursBeforeStart` and
// `minutesAfterStart` are frozen because they are the numbers the policy was
// evaluated against; reconstructing them later from a since-rescheduled session is
// exactly the dispute this avoids (Doc 4 §"Reservation").
//
// The `system` actor emits `reservation.auto_resolved`, NEVER `reservation.attended`
// or `.no_show` (I-18, AD-38). That separation is unrecoverable if collapsed.

export const RESERVATION_BOOKED = 'reservation.booked'
export const RESERVATION_CANCELLED = 'reservation.cancelled'
export const RESERVATION_LATE_CANCELLED = 'reservation.late_cancelled'
export const RESERVATION_ATTENDED = 'reservation.attended'
export const RESERVATION_NO_SHOW = 'reservation.no_show'
export const RESERVATION_AUTO_RESOLVED = 'reservation.auto_resolved'
export const RESERVATION_CORRECTED = 'reservation.corrected'
export const RESERVATION_NOTE_SET = 'reservation.note_set'

export type ReservationBookedPayload = {
  readonly entitlementId: EntitlementId
  readonly creditEffect: CreditEffect
  readonly creditsAvailableAfter: number | null // null ⇔ period entitlement (no hold)
  readonly sessionStartsAt: Instant
  readonly bookedCountAfter: number
}

export type ReservationCancelledPayload = {
  readonly hoursBeforeStart: number
  readonly withinWindow: false | true
  readonly creditEffect: CreditEffect
}

export type ReservationAttendedPayload = {
  readonly source: 'trainer'
  readonly minutesAfterStart: number
  readonly creditEffect: CreditEffect
}

export type ReservationNoShowPayload = {
  readonly source: 'trainer'
  readonly creditEffect: CreditEffect
}

export type ReservationAutoResolvedPayload = {
  readonly outcome: 'attended' | 'no_show'
  readonly source: 'system_default'
  readonly creditEffect: CreditEffect
  readonly creditsAvailableAfter: number | null
}

export type ReservationCorrectedPayload = {
  readonly from: ReservationStatus
  readonly to: ReservationStatus
  readonly reason: string
  readonly source: 'correction'
}
// The staff quick note (Hızlı Not). Staff-only — never surfaced to the member. Free
// text preserved intact (AI reads it later). EXTENSIBLE: future optional fields are
// additive and won't break v1.
export type ReservationNoteSetPayload = {
  readonly text: string
}
