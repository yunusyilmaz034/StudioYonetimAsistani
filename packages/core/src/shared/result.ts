import type { MemberId } from './ids'

// Domain errors are VALUES, not exceptions (Doc 6 §7): a booking refused because
// a class is full is the system working, and it returns a typed result the UI
// renders in Turkish. Infrastructure failures (Firestore down, token expired) are
// thrown instead — they are not modelled here.
//
// This union is a SKELETON. Each module adds its own codes (class_full,
// insufficient_credits, category_mismatch, …) as it is built; every code maps to
// exactly one Turkish message in the web layer — never a Turkish string in core.
export type DomainError =
  | { readonly code: 'reason_required' }
  | { readonly code: 'note_required' }
  | { readonly code: 'invalid_phone'; readonly value: string }
  | { readonly code: 'phone_already_registered'; readonly memberId: MemberId }
  | { readonly code: 'session_capacity_exceeds_room'; readonly capacity: number; readonly roomCapacity: number }
  | { readonly code: 'branch_mismatch' }
  | { readonly code: 'invalid_time_range' }
  // ── scheduling / session edits (Doc 11, v1.12) ──
  | { readonly code: 'session_not_editable' }
  | { readonly code: 'capacity_below_booked'; readonly bookedCount: number }
  | { readonly code: 'room_not_active' }
  // ── entitlements / credit ledger (Doc 2 §5) ──
  | { readonly code: 'insufficient_credits'; readonly available: number }
  | { readonly code: 'entitlement_not_active' }
  | { readonly code: 'not_a_credit_entitlement' }
  | { readonly code: 'no_held_credit' }
  | { readonly code: 'invalid_adjustment' }
  | { readonly code: 'held_credits_block_expiry'; readonly held: number }
  // ── reservations / booking (Doc 2 §7) ──
  | { readonly code: 'session_not_bookable' }
  | { readonly code: 'class_full'; readonly capacity: number }
  | { readonly code: 'already_booked' }
  | { readonly code: 'category_mismatch'; readonly sessionCategory: string; readonly entitlementCategory: string }
  | { readonly code: 'entitlement_expires_before_session' }
  | { readonly code: 'no_bookable_entitlement' }
  | { readonly code: 'reservation_not_open' }
  // ── reservations / automation (Doc 2 §8, v1.10) ──
  | { readonly code: 'auto_resolve_too_early'; readonly resolvableAt: number }
  | { readonly code: 'reservation_not_resolved' }
  | { readonly code: 'correction_credit_unsupported' }

export type DomainErrorCode = DomainError['code']

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok
