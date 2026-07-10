# 14 — Reservations Engine

> **Status: implemented (v1.9), core + synchronous paths.** How booking, cancellation,
> attendance, auto-resolution, and correction are built in
> `packages/core/modules/reservations`. It adds no new domain rules; it implements
> Doc 2 §7–§8 and Doc 4. Where they disagree, **Doc 2 wins.**

## Scope of v1.9

**In:** the reservation aggregate and state machine; every decision function as a
pure, tested decider — `decideBooking` (I-9, all seven preconditions), `decide
Cancellation` (§7.2), `decideAttendance`, `decideAutoResolution` (AD-38),
`decideCorrection`; `selectEntitlement` (I-17). The **synchronous** paths are fully
wired: booking and cancellation Server Actions, each a Firestore transaction (I-10)
that composes the reservation deciders with the credit-ledger movements (AD-53).
Golden fixtures for all seven events.

**Out (by design) — the v1.10 Automation milestone (`apps/functions`):**
- **Manual attendance marking** via the `/commands` offline path (`attendance.mark`
  is already whitelisted in the rules) and its `on-command-created` trigger.
- **Auto-resolution** as a scheduled job, and the **expiry sweep** (I-19 ordering).
- **Correction** wiring (the credit compensation) — the decider ships and is tested;
  its transactional composition lands with attendance.

The deciders for those paths exist and are tested now; only their runtime wiring is
deferred — the same pattern used for the credit ledger in v1.8.

## The booking transaction (I-10)

Booking spans three aggregates. In one `runTransaction`:

1. read the class session, the entitlement, and (as a transactional query) any
   existing `booked` reservation for this member+session;
2. `decideBooking(session, entitlement, memberHasBooked)` → `reservation.booked`,
   enforcing all seven of I-9 including the **category wall** (I-9.7);
3. `decideHold(entitlement, reservationId)` → `entitlement.credit_held` (skipped for
   a period entitlement, which holds nothing);
4. write the reservation, `session.bookedCount + 1`, the entitlement, and both events
   — atomically, under one `correlationId`.

A domain refusal aborts the transaction and returns a typed `err`; nothing is
written. The application supplies the pure `decide` callback; the repository holds no
domain logic and only runs the transaction (AD-55).

Cancellation is the mirror: read reservation + session + entitlement, `decide
Cancellation` (the six-hour window is `policy.cancellationWindowHours` — **nothing
knows the number six**), compose the matching ledger movement (release, or consume on
a late cancel that burns), free the seat (`bookedCount − 1`).

## selectEntitlement (I-17)

Earliest-expiring-first, so a member never burns a credit she was about to lose;
**credit packages are spent before an unlimited period package** (no scarcity);
deterministic tie-break `validUntil → purchasedAt → id`. Reception may override by
passing an explicit `entitlementId` to the booking action. The pre-transaction
selection is advisory — the transaction re-reads and `decideBooking` re-validates.

## Attendance is not its policy default (AD-38, I-18)

The `system` actor emits `reservation.auto_resolved` with `source: 'system_default'`,
**never** `reservation.attended`. Manual marking (`source: 'trainer'`) is a
confirmation/override. Collapsing the two would make the no-show rate a structural
zero and destroy the churn signal, permanently.

## Firestore

`/studios/{sid}/reservations/{reservationId}` — flat, studio-scoped. Carries the
bounded `memberSnapshot` (OQ-12, AD-44, four fields, never in an event, purged on
erasure) and denormalised `sessionStartsAt/EndsAt/Category`. Composite indexes:
`(memberId, classSessionId, status)` for the transactional double-book check,
`(classSessionId, status)` for the roster, `(memberId, sessionStartsAt)` for a
member's schedule. Writes are Admin-SDK only (AD-15).

## Authorization

Booking and cancellation: owner · receptionist · platform_admin, enforced in the
Server Action (AD-46). Member self-service booking is a later phase (the actor
taxonomy already supports it).

## Invariants owned

I-9 (booking preconditions) · I-10 (one transaction, or none) · I-14 (a studio-
cancelled class releases every held credit) · I-17 (deterministic selection) · I-18
(auto-resolve never masquerades as an observation). I-1…I-4, I-19, I-20 are the
entitlements module's, exercised here through its deciders.

## Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| **AD-55** | Booking/cancellation are cross-aggregate `runTransaction`s; the repo runs the transaction and the application supplies the pure `decide` callback composing reservation + ledger deciders. Session/entitlement Firestore mappers are exposed for this. | Domain logic inside the repository, or three separate writes — neither is atomic (I-10). |
| **AD-56** | The double-book guard (I-9.6) is a **transactional query** inside the booking transaction. | A `reservations_by_member_session` uniqueness document — more infrastructure for a guard the transaction already gives. |
| **AD-57** | Attendance (`/commands` + trigger), auto-resolution and the expiry sweep (scheduled), and correction wiring are the **v1.10 Automation** milestone; the deciders ship pure and tested now. | Building `apps/functions` inside v1.9 — a second runtime surface that doubles the milestone. |
