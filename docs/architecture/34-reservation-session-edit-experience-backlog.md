# 34 — Reservation & Session Edit Experience — **Phase 2 backlog**

**Status:** backlog — a Product Feedback from real use (owner, 2026-07-15), filed under Product Plus
**Phase 2 (Operations Workspace)**. **No implementation yet.** The roadmap does not change; this is a
backlog item within Phase 2.

---

## The problem (from real use)

Reception makes mistakes, and the product must let her fix them safely — not just for reservations,
but for **every operational record**, including the **Session Agenda** (Ders Ajandası). Real errors:
wrong reservation, wrong class, wrong trainer, wrong room, wrong class type, wrong date/time, wrong
member.

## Scope

**Reservation** — edit · change trainer · change room · change class type · change date · change time
· change member (if the rules allow) · cancel.

**Session Agenda (a created class)** — edit · change trainer · change room · change class type ·
change date/time · cancel if needed.

**Experience** — **Undo** the last action · **Redo** if needed · a safe reversal experience on
critical operations (a confirm, or an undo window, before something irreversible-feeling happens).

---

## The binding constraint (owner, non-negotiable)

> **This is NOT undoing events. Do not break event sourcing.** Every edit and every undo is a **new
> compensating event** — the correction pattern the domain already lives by (non-negotiable #9: a
> correction is a compensating event, never a silent overwrite; `reason` is mandatory).

So "Undo the booking I just made" is **a cancellation event**, not a deletion of the booking event.
"Undo the trainer change" is **another trainer-change event** back to the previous trainer. The log
only ever grows; it never rewrites. Undo/Redo is a UX layer that composes these compensating actions
and remembers the last one so the human can reverse it in one tap.

## What already exists (the seam is mostly built)

The domain already has the compensating actions this needs — they are just not unified into one edit
surface or an undo layer:
- `moveReservation` (date/time/session), `cancelReservation`, `correctReservation` (attendance).
- `changeTrainer`, `changeRoom`, `changeCapacity`, `cancelSession` on the class session.

So the work is **not new domain plumbing** for most of it — it is (a) a **unified, calm edit surface**
for a reservation and for a session, and (b) an **Undo/Redo layer** that records the last compensating
action and offers to reverse it (itself a compensating action). "Change member" is the one that may
need a new path (cancel + rebook, or a dedicated move-to-member) — to be designed, respecting the
credit ledger. All of it applies the approved Phase-1 visual identity; **the calendar layout is never
changed.**

**Related:** Doc 32 (Product Plus roadmap — Phase 2) · Doc 14 (reservations engine) · Doc 22
(reservation operations) · non-negotiables #1, #9 (events, compensating corrections).
