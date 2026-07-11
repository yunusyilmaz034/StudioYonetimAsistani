# 16 — Owner Dashboard · Design (v1.16)

> **Status: DESIGN LOCKED — decisions D1–D7 resolved (see §7). Pending the owner's
> final go-ahead to implement; no code yet.**
> The dashboard's purpose is **operational, not reporting**: the owner opens one screen
> and runs the day from it (UX-8 Owner First).
>
> **Locked:** **eleven widgets**; direct bounded multi-read, **no projection** (D1);
> uncollected balances by scanning active entitlements (D2); "no booking in N days" by
> reverse-scanning recent reservations (D3, default N = 14); a `/checkIns` day read +
> index (D4); a server snapshot + "Yenile" refresh (D5); single-branch scope (D6); the
> dashboard **replaces `/`** (D7). Widget #10 is **birthdays today** (bounded filter of
> the member list — no new read, no writes).

---

## 1. Purpose

*"The owner opens the product and immediately knows — and can act on — what needs
attention today."* (UX-8). The dashboard is the home screen: glanceable, dense
(UX-4), and every widget is a **door** into the workspace that acts on it (UX-6, No
Dead Ends) — never a dead-end report.

---

## 2. The one real decision: read strategy

CLAUDE.md sets the ideal *"owner dashboard = 1 read"* — which is only achievable with a
**projection** (a single pre-computed dashboard document, updated by an
`on-event-created` projector). But **projections are Phase 2** (`projections/` is
explicitly deferred; nothing reads one yet).

So v1.16 has a fork (**D1**):

- **A — Direct bounded reads (recommended).** The dashboard-query module composes a
  handful of **bounded, indexed** reads (one per widget group), in parallel, server-
  side. Not 1 read — ~8–10 cheap reads. Ships now, no new infrastructure, no Phase-2
  pull-forward. The "1 read" projection becomes a **transparent optimisation** later:
  swap the query module for a projection read, the UI unchanged.
- **B — Build the first projection now.** A `dashboard` projection doc maintained by a
  projector. Achieves the 1-read budget but pulls Phase-2 infrastructure (projectors,
  rebuild tooling, the projections module) into Phase 1.

**Recommendation: A.** It delivers the operational screen now; the projection is a
later, invisible speed-up. Each read below is bounded (today's window, active-only,
top-N) so the cost stays modest for a boutique studio.

---

## 3. Widgets → data map

| # | Widget | Source | Read | Status |
|---|---|---|---|---|
| 1 | **Şu anda içeride** (currently inside) | `/presence` | `checkin.listPresence(branch)` | **exists** |
| 2 | **Bugün check-in yapanlar** (today's check-ins) | `/checkIns` | `listCheckInsForDay(branch, dayStart)` | **new read** (+ index) |
| 3 | **Beklenen ama giriş yok** (expected absent) | reservations + presence | already in `checkin-query.loadCheckinState.expectedSoon` | **exists** |
| 4 | **Bugünkü dersler** (today's classes) | `/classSessions` | `scheduling.listSessionsForDay(from,to)` | **exists** |
| 5 | **Bugünkü PT dersleri** | today's sessions, `category==='private'` | filter of #4 | **exists** |
| 6 | **Yakında bitecek üyelikler** (expiring soon) | `/entitlements` | `listExpiringBetween(now, now+N)` — status active, `validUntil` in window | **new read** (index `(status, validUntil)` exists) |
| 7 | **Tahsil edilmemiş bakiyeler** (uncollected) | `/entitlements` | `listActive()` → filter `priceAgreed > paidTotal` | **new read** (D2) |
| 8 | **Son N gündür rezervasyon yapmayan aktif üyeler** (no booking in N days — **not** a check-in/attendance signal) | reservations + members | `listBySessionStartRange(now−N, now)` → memberIds who booked recently; subtract from active members | **new read pattern** (D3; N = policy, default **14**) |
| 9 | **Son eklenen üyeler** (recent members) | `/members` | `listMembers` sorted by `joinedAt` desc, top-N | **exists** |
| 10 | **Bugün doğum günü olan üyeler** (birthdays today) | `/members` | filter active members whose `birthDate` MM-DD == today (studio-local); show name + age (birthDate carries the year) | **exists** (no new read — from the loaded member list) |
| 11 | **Hızlı işlemler** (quick actions) | — | links to `/members` · Member→Abonelik · `/checkin` · `/schedule` | **exists** |

**Bounded by design:** #2/#3/#8 use today's / recent window; #6 the next-N-days window;
#7/#9 active-only + top-N; #10 filters the already-loaded member list. No unbounded scans.

**Naming precision (#8):** what v1.16 computes from existing data is *"active members
with no **reservation** in the last N days"* — it is **not** a check-in- or
attendance-based "hasn't come in" signal (that is a Phase-2 metric over the check-in
log). `N` is policy/config; default **14 days**.

---

## 4. New reads (core) + indexes

- **`checkin.listCheckInsForDay(ctx, branchId, since)`** — `/checkIns where branchId ==
  X and occurredAt >= since`, direction `'in'`. Index `checkIns (branchId, occurredAt)`
  (listed in Doc 3 §indexes; add to `firestore.indexes.json` if missing).
- **`entitlements.listExpiringBetween(ctx, from, to)`** — status `active`, `validUntil`
  in `[from, to]`, returning `{memberId, validUntil, productName}`. Reuses the existing
  `(status, validUntil)` index.
- **`entitlements.listActive(ctx)`** (for #7) — status `active`; the query filters
  `balanceDue > 0` in memory (D2). Index `(status)` — trivial.
- **Inactive members (#8, D3):** no new *core* read — compose `reservations.
  listBySessionStartRange(now−N, now)` (recent bookings → memberIds) and subtract from
  the active member list. Approximate (a member with a booking whose session already
  passed still counts as "recent"), which is the right operational meaning.

No new denormalised fields, no projector. (member.stats' `balanceDue`/`lastCheckInAt`
stay as they are; the dashboard computes fresh rather than depend on unwired stats.)

---

## 5. UI & layout

- **Route `/` (home) becomes the dashboard** for owner/reception — replacing the
  current "auth proof" home. Desktop: a **widget grid** (cards, dense); mobile: a
  **single-column stack** (UX-2, UX-4). Every card is scoped to the reception's branch
  (D6).
- **Quick actions** row at top: Yeni Üye · Yeni Abonelik · Giriş/Çıkış · Takvim — the
  four highest-frequency entries (UX-8, fewest clicks).
- **Every widget drills through** (UX-6): a class card → the session workspace; an
  expiring subscription → that member's workspace; an uncollected balance → the member;
  "expected absent" → `/checkin`. No dead ends.
- **Refresh (D5):** server-rendered snapshot with a manual "Yenile" + a soft auto-
  refresh interval. No realtime subscription in v1.16 (occupancy etc. are already
  eventual).
- **States:** each widget has its own empty/loading/populated states (Doc 09 §7).

---

## 6. Technical design

- **`dashboard-query.ts`** (web server) composes the ~8 bounded reads in parallel
  (`Promise.all`) into one `DashboardData` view model; the page server-component renders
  it. **No projection, no projector, no new module.**
- **New core reads** as in §4 (checkin + entitlements repos). Names resolved from the
  members list (loaded once, DEBT-001 pattern) — no per-row member reads.
- **Authz:** the dashboard is owner-first but reception also runs the day from it →
  `getTenantContext` gate (owner + receptionist + platform_admin).
- **Reused:** every workspace the widgets link into already exists (members, schedule,
  checkin, subscriptions).

---

## 7. Decisions — RESOLVED

| # | Decision | Resolution |
|---|---|---|
| **D1** | Read strategy. | **Direct bounded multi-read — no projection.** The 1-read projection is a later, invisible optimisation (Phase 2); the UI won't change when it lands. |
| **D2** | Uncollected balances (#7). | **Scan active entitlements + filter `balanceDue > 0`** (bounded). A denormalised indexed field only if it ever becomes slow. |
| **D3** | Inactive members (#8). | **Reverse-scan recent reservations & subtract** from active members (no schema change). Threshold **N days** is policy (the owner's number). |
| **D4** | Today's check-ins (#2). | **Yes** — a `/checkIns` day read + the `(branchId, occurredAt)` index (Doc 3). |
| **D5** | Refresh. | **Server snapshot + "Yenile" + soft interval.** No realtime in v1.16. |
| **D6** | Branch scope. | **Single branch** (`ctx.branchIds[0]`); multi-branch roll-up when a second branch exists. |
| **D7** | Home route. | **The dashboard replaces `/`** (it is the staff home). Keep the logout + role chip. |

---

## 8. What this milestone deliberately does not do

- No **projection / projector** (Phase 2) — the read strategy is transparent to swap later.
- No **realtime** widgets, no cross-branch roll-up (single branch in Phase 1).
- No **new business rules** — every widget reads existing state; the dashboard writes
  nothing (quick actions open existing workspaces).
- No **AI / insights / rules engine** (Phase 2) — this is glanceable operational data,
  not derived recommendations.

**Next step:** the owner reviews §7, we lock the decisions, and only then does
implementation begin.
