import type { Instant, ReservationId } from '../../shared'

// D20 events. No PII (I-13): the member is an id, the queue position is a number.
export const WAITLIST_JOINED = 'waitlist.joined'
export const WAITLIST_LEFT = 'waitlist.left'
export const WAITLIST_PROMOTED = 'waitlist.promoted'

export type WaitlistJoinedPayload = {
  readonly sessionStartsAt: Instant
  readonly position: number // 1-based, at the moment she joined
  readonly creditEffect: 'none' // I-29 — stated in the log, not merely implied
}

export type WaitlistLeftPayload = {
  readonly reason: 'member' | 'staff' | 'session_started'
}

export type WaitlistPromotedPayload = {
  readonly reservationId: ReservationId
  readonly waitedMinutes: number // how long the queue actually took — the owner's demand signal
}
