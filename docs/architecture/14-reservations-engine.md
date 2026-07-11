# 14 — Reservations Engine

> **Status: implemented (v1.9 core + synchronous; v1.10 automation).** How booking,
> cancellation, attendance, auto-resolution, and correction are built in
> `packages/core/modules/reservations`, plus the runtime automation in
> `apps/functions`. It adds no new domain rules; it implements Doc 2 §7–§8 and Doc 4.
> Where they disagree, **Doc 2 wins.**

## Scope of v1.9

**In:** the reservation aggregate and state machine; every decision function as a
pure, tested decider — `decideBooking` (I-9, all seven preconditions), `decide
Cancellation` (§7.2), `decideAttendance`, `decideAutoResolution` (AD-38),
`decideCorrection`; `selectEntitlement` (I-17). The **synchronous** paths are fully
wired: booking and cancellation Server Actions, each a Firestore transaction (I-10)
that composes the reservation deciders with the credit-ledger movements (AD-53).
Golden fixtures for all seven events.

**Out (by design):** UI. Attendance marking screens and the correction workspace are
the v1.11 Single-Workspace milestone (UX-1). v1.10 built the runtime layer beneath
them — command writer, triggers, sweeps, transactions — with no screens.

**Booking UI (v1.13).** Reservation and cancellation are surfaced inside the scheduling
**session workspace** (the calendar's session Sheet, Doc 11): reception picks a member,
sees advisory credit availability (`getBookingStatusAction` → `selectEntitlement`, I-17,
pre-transaction and advisory only), books, and cancels — all in one workspace (UX-1),
with a late-cancellation warning from `policy.cancellationWindowHours`. No domain change;
it composes the existing `bookReservationAction` / `cancelReservationAction`. The
`listBySession` roster read was added. "Uygun / Dolmak üzere / Dolu" is a **visual**
occupancy state — never a waitlist (`waitlisted` stays an unused enum seam).

## v1.10 — Automation (runtime layer)

The deciders shipped pure and tested in v1.9; v1.10 wires their runtime, mirroring the
v1.8 → v1.9 pattern. Nothing here adds a domain rule.

- **Manual attendance marking** takes the `/commands` offline path (AD-35): the client
  `markAttendanceCommand` (`apps/web/lib/commands.ts`) drops one `attendance.mark` doc;
  `on-command-created` applies it via `markAttendance`, resolving the reservation and
  consuming/releasing the held credit in one transaction. It is applied **as the
  marking principal** (trainer/receptionist) — never `system` (#5). *(AD-58)*
- **Auto-resolution** and **credit expiry** are two `system` sweeps run under **one
  nightly trigger, in order** — auto-resolve then expire — so I-19 holds by
  construction. *(AD-59)*
- **The grace window is enforced in the decider.** `decideAutoResolution` refuses
  `auto_resolve_too_early` until `endsAt + policy.autoResolveAfterMinutes`; the sweep's
  query is a coarse candidate cut the transaction re-validates. *(AD-60)*
- **Correction** wires the credit-return direction only: a consumed credit is
  `restored` (the DEBT-007 case). The re-consume direction is unresolved money
  arithmetic and is refused (`correction_credit_unsupported`, DEBT-010). *(AD-61)*
- **Causation.** A command stamps its `commandId` onto every event it causes; all
  events of one operation still share a `correlationId`.

The **resolve transaction** (`ReservationRepository.resolve`) is the cancel mirror
minus the seat write: a resolved booking still happened, so `bookedCount` never moves.
It carries attendance marking, auto-resolution, and correction alike (AD-55).

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
| **AD-58** | **The command envelope lives in `shared` (sibling of the event envelope); `attendance.mark` is applied by `on-command-created` as the writing principal.** Idempotency is the reservation's own state — a redelivery hits a no-longer-`booked` reservation and is refused, so a credit can never be consumed twice. | A command-processor module, or applying as `system` — the first is premature infrastructure, the second erases who marked the roster (#5, #11). |
| **AD-59** | **One nightly trigger sequences the two `system` sweeps** (auto-resolve → expire) so I-19 holds by construction. | Two separate cron functions — their relative firing order is not guaranteed, and I-19 is an invariant, not a hope. `decideExpire` refusing while `held > 0` remains the second line of defence. |
| **AD-60** | **The auto-resolution grace window is a pure decider refusal** (`auto_resolve_too_early`), reading `policy.autoResolveAfterMinutes`. The sweep query (`sessionEndsAt <= now`) is a coarse candidate cut the transaction re-validates. | Enforcing grace only via the query — leaves the policy field unenforced and makes a tighter sweep cadence silently wrong; the boundary (`exactly grace` vs one ms less) would be untestable. |
| **AD-61** | **Correction wires only the credit-return direction** (consumed → `restored`, the DEBT-007 case); the re-consume direction (a released credit drawn again) is refused (`correction_credit_unsupported`). | Guessing the re-consume arithmetic — there is no held credit to draw from, and inventing a consume-from-available movement is an unrecoverable money decision the owner has not made (DEBT-010). |
