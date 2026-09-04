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
  // ── AG-1 (v1.27) — the studio's opening hours, enforced. Stored since S2, policed since now. ──
  // Distinct from a CLOSURE (D21): "we do not open on Sundays" is not "we are closed this Sunday".
  | { readonly code: 'studio_closed_on_day' }
  | { readonly code: 'outside_working_hours'; readonly open: string; readonly close: string }
  // ── scheduling / session edits (Doc 11, v1.12) ──
  | { readonly code: 'session_not_editable' }
  | { readonly code: 'capacity_below_booked'; readonly bookedCount: number }
  | { readonly code: 'room_not_active' }
  // ── entitlements / credit ledger (Doc 2 §5) ──
  | { readonly code: 'insufficient_credits'; readonly available: number }
  | { readonly code: 'entitlement_not_active' }
  // D21.4 — a frozen package is never extended: freeze arithmetic is unbuilt (DEBT-009), and
  // extending one would be doing it by the back door.
  | { readonly code: 'entitlement_frozen' }
  // Freeze plans (owner, 2026-07-28). A duration is chosen up front now, so it can be wrong: zero
  // days is not a freeze, and more days than she has left is REFUSED rather than clamped — quietly
  // freezing for five when reception asked for ten is the studio not doing what it said.
  // A hybrid is ONE window over several categories. When they queue to different dates there is no
  // honest single window — later denies her the category that was free, earlier bills her twice for
  // the other — so an unattended checkout refuses and a human sells it with the real dates in view.
  | { readonly code: 'bundle_start_conflict' }
  | { readonly code: 'invalid_freeze_days' }
  | { readonly code: 'freeze_days_exceed_budget'; readonly remaining: number }
  // I-28 (v1.22) — a bulk act is applied at most once. `status` is the guard; a second apply is
  // REFUSED, not repeated.
  | { readonly code: 'operation_already_applied' }
  | { readonly code: 'operation_not_applicable' }
  | { readonly code: 'not_a_credit_entitlement' }
  | { readonly code: 'no_held_credit' }
  | { readonly code: 'invalid_adjustment' }
  | { readonly code: 'held_credits_block_expiry'; readonly held: number }
  | { readonly code: 'invalid_amount' }
  // ── finance (v1.24) ──
  | { readonly code: 'discount_exceeds_ceiling'; readonly ceilingPercent: number }
  | { readonly code: 'drawer_required' }
  | { readonly code: 'drawer_not_open' }
  // Kasada olmayan parayı çıkarmak, sayım farkını ileri bir tarihe taşımaktır (2026-09-04).
  | { readonly code: 'drawer_insufficient' }
  | { readonly code: 'drawer_already_open' }
  | { readonly code: 'drawer_open_cannot_archive' }
  | { readonly code: 'giftcard_not_found' }
  | { readonly code: 'giftcard_not_active' }
  | { readonly code: 'giftcard_insufficient'; readonly remaining: number }
  // ── member wallet (v1.27, Doc 27) — a debit that would go below zero is REFUSED, never clamped (I-37) ──
  | { readonly code: 'wallet_insufficient'; readonly balance: number; readonly requested: number }
  | { readonly code: 'allocation_exceeds_payment' }
  // A payment that names the sale it settles, naming one that cannot take it: not the member's, or
  // already cancelled. Refused rather than quietly falling back to oldest-debt-first, because that
  // fallback is exactly how a link for one package paid off a different one (OR-37).
  | { readonly code: 'allocation_target_invalid' }
  | { readonly code: 'allocation_exceeds_sale' }
  | { readonly code: 'plan_total_mismatch' }
  | { readonly code: 'coupon_invalid' }
  | { readonly code: 'lead_not_open' }
  // ── notifications (v1.25) ──
  | { readonly code: 'template_not_found' }
  | { readonly code: 'template_params_missing'; readonly missing: readonly string[] }
  | { readonly code: 'daily_limit_reached'; readonly limit: number }
  | { readonly code: 'notification_not_found' }
  | { readonly code: 'entitlement_not_cancelled' }
  // ── check-in (Doc 2 §9, v1.15) ──
  | { readonly code: 'branch_not_open' }
  // ── reservations / booking (Doc 2 §7) ──
  | { readonly code: 'session_not_bookable' }
  // Backdating (owner, 2026-08-02): reception recording a class that already happened. Bounded, so
  // an operational correction cannot quietly become a rewrite of a closed month.
  | { readonly code: 'session_too_old'; readonly earliest: number }
  // The package began AFTER the class. It matters only when backdating — a package bought today
  // cannot have paid for Tuesday's class, and nothing else in the system would have caught it.
  | { readonly code: 'entitlement_started_after_session' }
  | { readonly code: 'outside_cancellation_window' } // D19 — a member may not move a class late
  | { readonly code: 'waitlist_not_open' } // D20
  | { readonly code: 'already_waitlisted' }
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
  // ── seat holds for non-members (2026-07-27) ──
  // A hold with no note is a seat that silently vanishes and nobody can explain; a hold that is
  // already released cannot be released again.
  // Self-service checkout (2026-07-27) — two taps must not become two card charges. There is no
  // receptionist in that path to notice the second one.
  | { readonly code: 'payment_already_pending' }
  // The same package sold to the same member seconds apart (owner, 2026-07-29). Reception presses
  // again when the panel feels slow; every press is a complete sale. Refused, not swallowed — see
  // `entitlements/domain/duplicate.ts` for why this is not idempotency.
  | { readonly code: 'duplicate_sale_suspected' }
  // ── The door, pressed twice (owner, 2026-07-31) ──
  // A check-in/out used to be a pure toggle, so a second press reversed the first silently. Under a
  // button labelled "Çıkış" that is not a toggle, it is a bug: an exit recorded, then an entry
  // twenty-two seconds later, with reception told only about the exit.
  | { readonly code: 'already_inside' }
  | { readonly code: 'already_outside' }
  | { readonly code: 'checkin_too_soon' }
  | { readonly code: 'seat_hold_note_required' }
  | { readonly code: 'seat_hold_not_open' }
  // ── reservations / automation (Doc 2 §8, v1.10) ──
  | { readonly code: 'auto_resolve_too_early'; readonly resolvableAt: number }
  // ── reservations / resolution from a door check-in (2026-07-27) ──
  // Her scan speaks only for a class close to it in time, and never for one the studio cancelled.
  // Both refusals are ordinary: the check-in itself still stands, and the nightly sweep resolves
  // the reservation the way it always has.
  | { readonly code: 'checkin_outside_class_window'; readonly opensAt: number; readonly closesAt: number }
  | { readonly code: 'checkin_session_cancelled' }
  | { readonly code: 'reservation_not_resolved' }
  | { readonly code: 'correction_credit_unsupported' }
  // ── PF-37: PAYTR collections ──
  // A collection can only be reconciled or cancelled while it is still unreconciled.
  | { readonly code: 'paytr_collection_not_open' }
  // ── The signed-document archive (v1.28) ──
  // A document must have at least one page; a removal must name the document it removes.
  | { readonly code: 'document_empty' }
  | { readonly code: 'document_not_found' }
  // ── KVKK erasure (v1.26 · AD-67) ──
  // Erasure is a BREAK-GLASS act, not an operation. Reception must not be able to make a member
  // disappear — and neither must the owner, in the middle of an argument.
  | { readonly code: 'erasure_requires_platform_admin' }
  // ── staff (v1.27 S1 · AD-68) ──
  // Granting a role is the quietest way to widen access in this system: making somebody a
  // receptionist hands her every member's phone number and the key to the till.
  | { readonly code: 'staff_admin_required' }
  | { readonly code: 'name_required' }
  | { readonly code: 'cannot_deactivate_self' }
  // A studio ALWAYS has at least one active owner (owner, 2026-07-13). She is the only principal who
  // can administer staff; a studio whose last owner was demoted has locked every human out of its
  // own permission system, and the way back is a developer with admin credentials.
  | { readonly code: 'last_owner_required' }
  // ── mesai (owner, 2026-09-01) ──
  // Vardiyayı yazan, vardiyayı yaşayan kişidir. Bir başkasının saatini yazmak bir düzeltmedir ve
  // düzeltmenin yolu telafi kaydıdır (#9) — sessizce başkasının adına mesai açmak değil.
  | { readonly code: 'own_shift_only' }
  // Açık vardiya varken ikincisi açılmaz: gün sonunda hangisinin gerçek olduğu bilinemez olurdu.
  | { readonly code: 'shift_already_open' }
  | { readonly code: 'no_open_shift' }
  // ── freeze (v1.27 S3 · owner, 2026-07-13 · closes DEBT-009) ──
  | { readonly code: 'freeze_not_allowed' }
  | { readonly code: 'freeze_budget_exhausted' }
  // Owner: no credit and no reservation is EVER changed silently. She is told, and she decides.
  | { readonly code: 'freeze_blocked_by_reservation' }
  | { readonly code: 'entitlement_already_frozen' }
  | { readonly code: 'entitlement_not_frozen' }
  // ── freeze booked for later (owner, 2026-08-31) ──
  // Going past the studio's own terms stays allowed, and stops being silent: the reason is asked for
  // at the moment of the exception, when the person still knows it.
  | { readonly code: 'freeze_override_reason_required' }
  // Two windows on one membership cannot both be honoured; choosing one silently would be the system
  // deciding something the desk did not.
  | { readonly code: 'freeze_already_scheduled' }
  // Today is not a plan, it is a freeze — and it has its own function and its own event.
  | { readonly code: 'freeze_start_not_future' }
  | { readonly code: 'freeze_not_scheduled' }
  | { readonly code: 'freeze_not_due' }
  // Süresi dolmuş KREDİLİ paketin tarihini ileri almak (2026-08-31). Süre dolarken kalan krediler
  // yakılır; sadece tarihi taşımak 0 kredili "aktif" bir paket üretir — sessizce yanlış olan hâli.
  | { readonly code: 'expired_credits_cannot_revive' }
  // Turnike: canlı paketi olmayan üyeye kol dönmez (owner, 2026-08-31). ÇIKIŞTA asla kullanılmaz —
  // içerideki birini içeride tutmak bir kural değil, bir arızadır.
  | { readonly code: 'no_active_membership' }
  // ── Package Rules 2.0 (Plus Phase 3) ──
  // Member restriction validation (a malformed rule is refused, never silently reinterpreted).
  | { readonly code: 'invalid_weekday' }
  | { readonly code: 'invalid_hour_range' }
  | { readonly code: 'invalid_allowance' }
  | { readonly code: 'invalid_limit' }
  | { readonly code: 'invalid_trainer' }
  | { readonly code: 'invalid_validity_range' }
  // Plus Phase 5 — a deactivated notification template stops new sends.
  | { readonly code: 'template_inactive' }
  // ── Plus Phase 6 (Commerce & Payments / PAYTR) ──
  | { readonly code: 'payment_ref_mismatch' }
  | { readonly code: 'payment_not_pending' }
  | { readonly code: 'payment_not_refundable' }
  | { readonly code: 'refund_exceeds_paid' }
  | { readonly code: 'payment_provider_not_configured' }
  // The provider IS configured, but the PAYTR API rejected the checkout/link call. The real reason
  // rides alongside as `providerError` — NOT a configuration problem, so it must not read as one.
  | { readonly code: 'payment_checkout_failed' }
  // ── ONLINE SATIŞ: the human step between a paid public purchase and a membership ──
  | { readonly code: 'payment_not_paid' }
  | { readonly code: 'payment_already_fulfilled' }
  | { readonly code: 'member_required' }
  | { readonly code: 'online_sale_not_found' }
  | { readonly code: 'retail_out_of_stock'; readonly available: number }
  // ── Plus Phase 7 (Training & Progress) ──
  | { readonly code: 'program_archived' }
  // Sürüm geri çekme (owner onayı, 2026-09-03). Üçü de bir REDDİN adıdır: son yayındaki sürüm
  // kaldırılamaz (programsız program olmaz), aynı sürüm iki kez geri çekilemez (ikinci kayıt ilkinin
  // sebebini gölgeler), ve geri çekilmemiş bir sürüm geri alınamaz.
  | { readonly code: 'program_version_not_found' }
  | { readonly code: 'program_version_already_retracted' }
  | { readonly code: 'program_version_not_retracted' }
  | { readonly code: 'program_last_version' }
  | { readonly code: 'program_empty' }
  | { readonly code: 'program_version_conflict' }
  // v1.31 — the workout cycle is walked in order, 1 → 2 → 3 → 1 (owner: "sıralama atlamaya izin
  // yok"). `expected` is the day she may do, so the screen can say which one rather than just "no".
  | { readonly code: 'workout_day_out_of_order'; readonly expected: number }
  // ── Program templates (Plus, pilot) ──
  | { readonly code: 'template_name_required' }
  | { readonly code: 'template_empty' }
  | { readonly code: 'template_not_found_pt' }
  // ── Plus Phase 9 (Trainer Payroll & Commission) ──
  | { readonly code: 'invalid_compensation_rate' }
  | { readonly code: 'invalid_commission_percent' }
  | { readonly code: 'compensation_plan_missing' }
  | { readonly code: 'payroll_already_finalized' }
  | { readonly code: 'statement_not_finalized' }
  | { readonly code: 'statement_already_paid' }
  // Reservation-time enforcement of the effective (resolved) policy. Each says WHICH rule refused,
  // so the UI can tell the member why — never a bare "rezervasyon yapılamadı".
  | { readonly code: 'cancellation_allowance_exhausted'; readonly allowance: number }
  | { readonly code: 'day_not_allowed' }
  | { readonly code: 'time_not_allowed' }
  // Plus Phase 4 — Member Override trainer restriction.
  | { readonly code: 'trainer_not_allowed' }
  | { readonly code: 'daily_reservation_limit_reached'; readonly limit: number }
  | { readonly code: 'active_reservation_limit_reached'; readonly limit: number }
  // Fit Paket (2026-08-20) — the session admits this package's category but caps how many times a
  // week it may be used. Distinct from the two above on purpose: those are limits the PACKAGE carries
  // with it everywhere, this one belongs to the CLASS and applies only there.
  | { readonly code: 'weekly_quota_reached'; readonly limit: number }

export type DomainErrorCode = DomainError['code']

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok
