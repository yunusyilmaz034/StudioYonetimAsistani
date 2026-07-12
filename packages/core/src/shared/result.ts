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
  | { readonly code: 'invalid_amount' }
  | { readonly code: 'entitlement_not_cancelled' }
  // ── check-in (Doc 2 §9, v1.15) ──
  | { readonly code: 'branch_not_open' }
  // ── reservations / booking (Doc 2 §7) ──
  | { readonly code: 'session_not_bookable' }
  | { readonly code: 'class_full'; readonly capacity: number }
  | { readonly code: 'already_booked' }
  | { readonly code: 'category_mismatch'; readonly sessionCategory: string; readonly entitlementCategory: string }
  // D12 (v1.21) — service-level eligibility. The package names the services it covers;
  // an entitlement sold BEFORE D12 carries no list and keeps its category-wide right.
  | { readonly code: 'service_not_covered'; readonly sessionServiceId: string }
  // D12 — a product must name the services it covers: "covers nothing" and "covers the
  // whole category" must never be the same value (AD-41: the catalogue is data).
  | { readonly code: 'product_requires_service' }
  // D13 (v1.21) — PT ownership. An assigned private session belongs to one member.
  | { readonly code: 'session_not_assigned_to_member' }
  | { readonly code: 'assignment_requires_private_session' }
  | { readonly code: 'session_has_reservations' }
  // D13 — PT is 1-on-1 or partner (max 2). Three or more is a group class, not a PT.
  | { readonly code: 'pt_capacity_exceeded'; readonly maxCapacity: number; readonly capacity: number }
  // D13 — reserving a PT slot FOR a member only makes sense if she could actually book it:
  // an active package that covers this service, with credit left. Re-checked server-side.
  | { readonly code: 'member_not_eligible_for_service' }
  // ── member portal (v1.21) ──
  // ONE error for every invite failure — wrong / expired / already used / unknown member. An
  // attacker probing links must not learn which.
  | { readonly code: 'invite_invalid' }
  | { readonly code: 'member_not_active' }
  | { readonly code: 'weak_password' }
  // D11 — this service has not opted into member self-booking (policy, not an `if`).
  | { readonly code: 'member_self_booking_disabled' }
  // D16 — the dynamic check-in QR. One error per failure MODE (invalid / expired / already
  // used), because reception needs to know what to tell the person standing in front of her.
  | { readonly code: 'qr_invalid' }
  | { readonly code: 'qr_expired' }
  | { readonly code: 'qr_used' }
  // D14 — no level of the cancellation-window chain answered (session → service → studio).
  // The domain REFUSES rather than inventing a number: nothing in the code knows the six.
  | { readonly code: 'cancellation_window_unresolved' }
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
