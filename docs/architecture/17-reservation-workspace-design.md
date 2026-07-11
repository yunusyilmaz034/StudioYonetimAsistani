# 17 — Reservation Workspace · Design (v1.17)

> **Status: IMPLEMENTED (v1.17). UI-only; no new reservation domain rules.**
> Built as designed: `/reservations` (Day/Week/Agenda + filters), the enriched
> reservation read (`reservations-workspace-query.ts`), single/multi/bulk booking and
> cancellation over the existing actions, drill-through. Move/waitlist/recurring
> deferred by owner decision.
>
> Reception's reservation-operations screen: see, search, filter, and
> manage **all** reservations from one place. Central object: **Reservation**. It
> composes the existing booking/cancellation rules (v1.9/v1.13) from the
> reservation/member angle — it is not a copy of the scheduling or session screens.

---

## 1. Boundaries with v1.12 / v1.13

| Screen | Central object | Does |
|---|---|---|
| **v1.12 Scheduling Workspace** | Session | creates sessions, manages the calendar, trainer/room/capacity |
| **v1.13 Booking UI** | Session | adds/removes a member **inside a session's** roster |
| **v1.17 Reservation Workspace** | **Reservation** | manages **all** reservations, reservation-first — reception's reservation-operations screen |

Same domain rules (I-9/I-10 booking, cancellation §7.2, `selectEntitlement` I-17), a
different lens. **No new reservation domain rule is written.**

## 2. Locked scope

**In:** global reservation view (Day / Week / Agenda-list); filters by date · member ·
trainer · service · session · status; create a reservation for a searched member;
add several members to one session; bulk create (loop); cancel; capacity/occupancy;
late-cancellation warning; drill-through to the Member and Session/Scheduling
workspaces.

**Out (owner decisions):**
- **Move / reschedule a reservation** — deferred to a separate milestone. For now
  reception uses **cancel + re-book**. (A true atomic `moveReservation` needs a
  credit-burn-semantics decision; not in v1.17.)
- **Waitlist** — Phase 2 (`waitlisted` stays an unused enum seam).
- **Recurring / standing reservations** — Phase 2 (no recurring-reservation infra).

## 3. Views & filters

- **Views:** Day · Week · Agenda/List. No Month (reservation ops are day/week-focused;
  Month is the scheduling calendar's job). Desktop dense table; mobile card/list.
- **Filters** (all in-memory over one loaded window): date (the window) · member ·
  trainer · service/category · session · reservation status.

## 4. Read / query model

One **enriched-reservation** read (a new web query module) — a join of two existing
core reads, **no new core read**:

- `reservations.listBySessionStartRange(from, to)` → reservations (memberSnapshot,
  status, sessionStartsAt, classSessionId, entitlementId).
- `scheduling.listSessionsForDay(from, to)` → session facts (serviceName, trainerName,
  roomName, capacity, bookedCount, category, cancellationWindowHours, policy).
- Joined by `classSessionId` → each reservation enriched with trainer/service/
  occupancy/late-window. Filters derive from this set.

## 5. Write actions

All **existing**, reused as-is:
- `bookReservationAction({ memberId, sessionId })` (v1.13) — single, and looped for
  **multi-member / bulk** (application/UI loop with per-item results).
- `cancelReservationAction({ reservationId })` — cancel (late-cancel burn per policy,
  domain-enforced; the UI warns).

No new action, no new decider.

## 6. Mobile / Desktop UX

Single Workspace (UX-1): views + filters + book/cancel on one screen, no needless page
transitions. Desktop dense table/agenda; mobile card/list/accordion — capability
identical (UX-2/7). Member search (DEBT-001 cache). Late-cancel warning (v1.13
pattern). Every row drills through (member `?member=`, session/scheduling). Occupancy on
every session. Owner/reception run it fully from a phone.

## 7. Supported by existing infra

- ✅ **Ready:** the two range reads, `bookReservationAction`, `cancelReservationAction`,
  occupancy from `session.bookedCount/capacity`, late-window from `policySnapshot`.
- 🔧 **Small app/UI:** the enriched query (join), the multi/bulk booking loop, the
  views/filters UI, member search.
- **No core change** — v1.17 is a web-only milestone.

## 8. New decisions

**None.** All three domain-touching items (move, waitlist, recurring) are deferred by
owner decision. Nothing in v1.17 needs a new domain/business decision.

## 9. Out of scope

Move/reschedule · waitlist · recurring/standing · session create/edit (v1.12) · Month
calendar · any new domain rule.

## 10. Validation & risks

- `pnpm check` + `next build` green; responsive at 375 · 430 · 768 · 1280.
- **Risk — read cost:** the enriched read is bounded by the visible window; a wide Week
  with many reservations is the worst case — acceptable, window-bounded.
- **Risk — no live runtime verification** (emulator/Java): static validation only
  (typecheck + tests + build).
- **Bulk booking:** per-item domain refusals (no credit / full / category wall) are
  surfaced individually, never silently dropped.
