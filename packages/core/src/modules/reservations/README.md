# `reservations` — booking, resolution, and the attendance truth

## Purpose

A `Reservation` is a member's claim on a seat in a `ClassSession`, and the record of
what became of it (Doc 2 §7–§8). It sits on top of two modules — `scheduling` (the
session and its policy snapshot) and `entitlements` (the credit ledger) — and composes
their deciders inside its own transactions (AD-53, AD-55). This module owns the single
most consequential distinction in the system: **a presumption is not an observation**
(AD-38).

**Booking holds a credit; resolution consumes it.** `available` drops the moment a
member books (E1); the credit stays reversible until the reservation resolves —
attended, no-show, late-cancelled, auto-resolved, or corrected.

## Public API (`index.ts`)

- **Types** — `Reservation`, `ReservationStatus`, `AttendanceSource`, `CreditEffect`.
- **Commands** — `ATTENDANCE_MARK`, `AttendanceMarkPayload` (the `/commands` surface).
- **Pure deciders** (`domain/decide.ts`) — `decideBooking` (I-9), `decideCancellation`,
  `decideAttendance`, `decideAutoResolution` (AD-38, grace guard AD-60),
  `decideCorrection`; `selectEntitlement`/`isBookable` (I-17). No I/O, no clock.
- **Use-cases** (`application/`):
  - *Synchronous Server Actions* — `bookReservation`, `cancelReservation` (allocate a
    seat / move a credit → trusted, never `/commands`).
  - *Offline command* — `markAttendance` (applied by `on-command-created`).
  - *Scheduled (`system`)* — `autoResolveReservation`, `sweepAutoResolve`.
  - *Correction* — `correctReservation` (compensating; restore direction only, AD-61).
- **Infrastructure** — `FirestoreReservationRepository` (Admin SDK only, AD-15); the
  `book` / `cancel` / `resolve` transactions; reads `listResolvableBooked` (sweep),
  `listBySessionStartRange` (attendance roster), `listBySession` (booking roster),
  `listByMember` (Member Workspace, v1.18).
  Session/entitlement mappers are exposed for the cross-aggregate transactions.

## The two write shapes

| Path | Who | Writes | Seat count |
|---|---|---|---|
| `book` | Server Action | reservation + `bookedCount+1` + entitlement `held+1` | +1 |
| `cancel` | Server Action | reservation + `bookedCount−1` + release/consume | −1 |
| `resolve` | command trigger · sweep · correction | reservation + entitlement | **unchanged** |

A resolved booking still *happened*, so `resolve` never moves `bookedCount` — only a
cancellation frees a seat.

## Attendance is not its policy default (AD-38, I-18)

The `system` sweep emits `reservation.auto_resolved` with `source: 'system_default'`,
**never** `reservation.attended`. Manual marking (`source: 'trainer'`) is a
confirmation/override. Collapsing the two makes the no-show rate a structural zero and
destroys the churn signal, permanently and unrecoverably. The grace window
(`policy.autoResolveAfterMinutes`) is enforced in the decider (AD-60), so a marker
always owns the window before the default claims it.

### Three ways to be resolved without being observed (2026-07-27)

The studio has no tablet at reception, so a printed QR hangs on the wall and the **member** scans
it. The owner's rule: *"a member who scans and has a class is at that class — this is a small
studio, nobody wanders around inside."* Operationally true, so `resolveOnCheckIn` closes the
yoklama at the door instead of leaving it to the nightly sweep.

It is still **not an observation** — nobody watched her take the class — so it emits the same
`reservation.auto_resolved`, distinguished by `source`:

| `source` | The evidence | Emitted by |
|---|---|---|
| `system_default` | nothing happened; the policy filled a silence | the nightly sweep |
| `member_checkin` | her own recorded, time-stamped scan at the door | `resolveOnCheckIn` |
| `trainer` (on `.attended`) | somebody stood in the room and said so | manual marking |

Two rules keep the door scan honest, both in `decideCheckInResolution`:

- **a time window** — the scan speaks only for a class near it (`qr.checkInWindowMinutes` before
  the start, through the session's own grace window after the end). Without it, arriving at 09:00
  marks the 19:00 class attended and consumes its credit — a presumption about a class that has
  not happened, which is the one thing the ledger must never contain.
- **one reservation, the nearest** — one arrival is evidence of one class.

The outcome is `attended` and does **not** consult `attendanceDefaultOutcome`: that policy answers
*"what do we assume when we know nothing?"*, and here we know something.

**Anything reading `attendanceSource` must classify as observed-or-else, never by listing the
presumed values.** Naming them one by one is how a trainer's pay report silently stopped counting
door-scanned attendances the day this source was added.

## Invariants this module owns

- **I-9** booking preconditions (all seven, incl. the category wall I-9.7).
- **I-10** booking/cancellation write their documents in **one transaction, or none**.
- **I-14** a studio-cancelled class releases every held credit, unconditionally.
- **I-17** deterministic entitlement selection (earliest-expiring; `validUntil →
  purchasedAt → id`; credits before an unlimited period package).
- **I-18** auto-resolution never masquerades as an observation.

I-1…I-4, I-19, I-20 are the entitlements module's, exercised here through its deciders.

## Deferred (not in this module yet)

- **Attendance / correction UI** — the Single-Workspace screens are v1.11.
- **The correction re-consume direction** — refused; unresolved money arithmetic
  (DEBT-010).
- **`waitlisted`** — an enum seam only; nothing produces it in Phase 1.
