# fitness — Fitness Attendance & Occupancy (Plus Phase 8)

**Purpose.** Entry history, consistency/streaks, usage reports, and a live occupancy
level — for fitness (unlimited / period) memberships that have **no reservation and no
class**. The date and time the member came *is* the whole signal.

## The invariant this module owns — the one to hold

> Fitness attendance is a **read/report layer over the existing `member.checked_in`
> events** (the checkin module, v1.15). It **emits no events, defines no aggregate, and
> touches no credit.**

The `check-in ≠ attendance` non-negotiable (#11) exists to protect *credit consumption*:
a presumption must never masquerade as an observation. Fitness consumes nothing, so the
check-in *is* the attendance — **provided it is never dressed up as one**. This module
therefore **never** emits `reservation.attended`, never writes a `fitness_visit` event
(that would be a second, drifting source of truth for occupancy — #2), and never reads or
moves an entitlement. Everything here is a pure function over check-in facts the checkin
module already records.

## Public API (all pure)

- `occupancyLevel(occupancy, config)` — the anonymous band (Sakin / Orta / Yoğun / Çok yoğun)
  a count maps to, given the studio's capacity + thresholds. Thresholds are **data**, not an
  `if` — a studio sets its own (#4's spirit). Returns `null` when capacity is unset.
- `computeVisitStats(visitEpochDays, nowEpochDay)` — total visit days, this-week count,
  current weekly streak, longest weekly streak, last visit. Epoch days are timezone-shifted
  by the caller (the domain has no clock and no `Date`).
- `busiestBuckets(samples, topN)` / `weekdayHourHistogram(samples)` — the historical
  busy-ness aggregation the prediction card reads.

The web layer loads check-ins via the checkin repo, converts instants to timezone-local
epoch-days / weekday-hours, and feeds these functions. Nothing here imports firebase-admin.
