import type { ReservationId } from '../../shared'

// The reservation commands (Doc 3 §5). A command is offline-safe and idempotent —
// it takes the `/commands` path (AD-35), unlike booking/cancellation which allocate
// a scarce seat or move money synchronously and are Server Actions.
//
// `attendance.mark` is the whole reservation command surface in Phase 1: a trainer
// or receptionist marks the roster, possibly from a phone with no signal. The write
// is a `/commands` doc; `on-command-created` applies it as `reservation.attended`
// or `reservation.no_show` with `source: 'trainer'` — the marking principal is the
// actor, never `system` (non-negotiable #5). Auto-resolution is the opposite path:
// a scheduled `system` job, never a command.

export const ATTENDANCE_MARK = 'attendance.mark'
export type AttendanceMarkType = typeof ATTENDANCE_MARK

export type AttendanceOutcome = 'attended' | 'no_show'

export interface AttendanceMarkPayload {
  readonly reservationId: ReservationId
  readonly outcome: AttendanceOutcome
}
