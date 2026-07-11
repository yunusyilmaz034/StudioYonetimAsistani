# Changelog

Studio Operating System — Phase 1. Every milestone is a product version with a git
tag; one commit per milestone. Dates are the milestone's completion. `main` is always
in a working state (`pnpm check` green).

All notable changes are recorded here. Architecture rationale lives in
`docs/architecture/` (numbered `AD-nn`); deliberate debt in `docs/DEBT.md`.

---

## v1.18 — Member Workspace · `v1.18-member-workspace`

- Reception's single-screen operations centre for one member — a **dedicated full-page
  route `/members/[id]`** (D1), Single Workspace: desktop tabs / mobile section-nav.
  Seven sections: Genel (profile + stats + edit/deactivate), Paketler (the v1.14
  `SubscriptionsPanel`), Rezervasyonlar (upcoming + last-50 past, quick-book, cancel,
  drill to `/reservations`), Check-in (inside-now, last-90-days history, QR card, quick
  check-in, drill to `/checkin`), Ödemeler (the v1.14 payment seam — balance/collected
  per package, ready for v1.19), İşlem Geçmişi (member audit timeline), and a quick-action
  bar.
- **No new domain rule, event or decider.** Three **read-only** core reads added:
  `reservations.listByMember`, `checkin.listCheckInsByMember` (+ a `checkIns
  (memberId, occurredAt)` index), `members.listMemberEvents` (`related.memberId`,
  auto-indexed). One web query `member-workspace-query.ts` — ~5 bounded parallel reads,
  no projection (D2); the Packages/Payments sections load subscriptions client-side via
  the existing action.
- **Bounds are centralised** in `MEMBER_WORKSPACE_LIMITS` (D3): check-in 90 days ·
  reservations 50 past · audit 100 — no scattered literals.
- Member drill-throughs (dashboard, reservations) now open `/members/[id]`; the legacy
  `/members?member=<id>` redirects there. The members list navigates to the workspace;
  its detail Sheet moved into the full-page workspace.
- A quick-book Server Action (`listUpcomingSessionsAction`, read-only) powers the
  in-context session picker.

## v1.19 — Calendars, Session Workspace, Week Duplication & Global Nav · `v1.19-calendars-session-workspace`

- **Shared calendar engine** (`components/calendar/`) — one data-agnostic Month/Week/Day/
  Agenda grid + interactive **"+N events" day popover** + toolbar + filters, used by both
  calendars (removes the duplication that `/schedule` and `/reservations` carried).
- **Class Calendar** (`/schedule`) adopts the engine; **Reservation Calendar**
  (`/reservations`) rewritten onto it — a **dense, member-name** session calendar with a
  Month view (a `loadSchedule` + reservation-window join; no new core read). Reservation
  member names link to the member workspace.
- **Session Workspace** (tabbed, replaces the single-column sheet): **Ders Bilgileri**
  (trainer/room/capacity/cancel) · **Rezervasyonlar** (roster, add/cancel, Hızlı Not per
  member) · **Yoklama** (one-tap attended/no-show, bulk, correction) · **Notlar**. Opened
  from both calendars.
- **Notes** — two new events: `class_session.note_set` (Ders Notu, staff/members
  visibility, member-portal-ready) and `reservation.note_set` (Hızlı Not, staff-only).
  Free text preserved; payloads designed additive/extensible (future attachments/links/AI).
- **"Bu haftayı tekrarla"** — session-week duplication, application-layer over
  `scheduleSession`; conflict = same room + start time (room-less: service + time), no
  overwrite, no past; **pre-flight preview** (create / conflict / past) with source-week
  picker and target-range display. Pure `computeDuplicationPlan` + 5 tests. **No new
  domain rule** (owner decision C1).
- **Persistent global navigation** (`AppShell`) across all owner screens (desktop rail /
  mobile bottom bar); redundant per-screen "Ana Sayfa" links removed. Styling intentionally
  plain — the premium visual pass is v1.20.
- Attendance **marking** rides the offline `/commands` path and needs the Functions
  trigger, which the emulator can't load here (DEBT-011, repay in v1.24). Member portal +
  member auth split to v1.20/v1.21.

## v1.17 — Reservation Workspace · `v1.17-reservation-workspace`

- Reception's reservation-operations screen (`/reservations`): all reservations,
  reservation-first — Day / Week / Agenda views; filters by member, trainer, service,
  session, and status; create for a searched member (single, multi-member into a
  session, and bulk); cancel with a late-cancellation warning; capacity/occupancy;
  drill-through to the member and scheduling workspaces.
- **UI-only, no new domain rules** — an enriched read (`reservations-workspace-query.ts`,
  a join of `listBySessionStartRange` + `listSessionsForDay`) over the existing
  `bookReservationAction` / `cancelReservationAction`.
- **Deferred** (owner): reservation move/reschedule (separate milestone), waitlist and
  recurring/standing reservations (Phase 2).

## v1.16 — Owner Dashboard · `v1.16-owner-dashboard`

- The **dashboard is the staff home** (`/`): an operational command screen (not a
  report). Eleven widgets — currently inside, today's check-ins, expected-but-absent,
  today's classes, today's PT, expiring subscriptions, uncollected balances, members
  with no booking in 14 days, birthdays today, recent members, and quick actions
  (Yeni Üye / Yeni Abonelik / Giriş-Çıkış / Rezervasyon).
- **Direct bounded reads, no projection** (D1) — `dashboard-query.ts` composes ~8
  windowed/indexed reads in parallel; the 1-read projection is a later, invisible
  optimisation. New core reads: `checkin.listCheckInsForDay`,
  `entitlements.listExpiringBetween` / `listActive` (+ `checkIns (branchId, occurredAt)`
  index).
- Every widget **drills through** into its workspace (members `?member=`, schedule,
  check-in); the dashboard writes nothing.

## v1.15 — QR Access & Check-in · `v1.15-qr-checkin`

- **`checkin` module** — check-in ≠ attendance (Doc 2 §9); `decideCheckIn` is a toggle
  (outside → in, inside → out) over a `/presence` doc; occupancy is a bounded read.
  Branch open/close (`branch.opened`/`branch.closed`) bounds the day; a nightly `system`
  auto-check-out at 4 h keeps occupancy honest. No new event types — all five are in the
  Doc 4 catalogue.
- **Offline path** — `checkIn.record` (already whitelisted) dispatched by the v1.10
  `on-command-created` trigger; applied as the receptionist (never the member).
- **QR** — the member's QR encodes the opaque `memberId`; a printable QR card in the
  member workspace. Reception scans it (native `BarcodeDetector`) or finds the member by
  name/phone — both write the same command.
- **UI** — `/checkin`: live occupancy, open/close branch, QR scan + member search
  toggle, currently-inside list, and an "expected but absent" prompt (reservations
  starting within 15 min with no check-in).

## v1.14 — Package Catalogue + Manual Subscription Assignment · `v1.14-catalogue-subscriptions`

- **`catalog` module** — `Product` CRUD (name, category, service scope, credit/period
  grant, price in kuruş, freeze/daily-limit/cancellation allowances, description).
  `product.created` + generic `product.updated`; products are deactivated, never
  deleted. Owner + platform_admin (AD-64).
- **Manual subscription assignment** — owner/reception assign a package to a member and
  record a **manual payment** (record-only seam, not a payments engine, AD-65).
  `assignSubscription` is atomic: `entitlement.purchased` → optional `adjusted` (credit
  override) → optional `payment_recorded`. `balanceDue = priceAgreed − collected`.
- **Subscription edits** — generic `entitlement.amended` (dates/price/payment, before +
  after, mandatory reason), `entitlement.reactivated`; credit edits reuse
  `entitlement.adjusted`.
- **UI** — `/packages` catalogue; a Subscriptions panel in the Member workspace
  (active/past, inline assign, amend/credit/status dialogs, audit timeline).
- Explicitly **out**: POS, gateway, iyzico, allocation engine, refunds, instalments,
  self-service, invoicing, campaigns.

## v1.13 — Booking UI · `v1.13-booking-ui`

- Booking and cancellation inside the scheduling **session workspace**: roster, inline
  member search, instant advisory credit availability (`selectEntitlement`, I-17),
  one-tap book, late-cancellation warning. Visual occupancy (Uygun / Dolmak üzere /
  Dolu) — never a waitlist. UI over the existing deciders; no domain change.

## v1.12 — Scheduling Workspace / Calendar · `v1.12-scheduling-workspace`

- `/schedule`: Month/Week/Day/Agenda views, service/room/trainer/branch/status filters,
  session detail Sheet. Create session, cancel, change trainer/room/capacity, weekly
  template view/create/edit/generate.
- New binding rule **I-26**: a started or completed session is never editable. New
  events `class_session.room_changed`, `class_session.capacity_changed`,
  `class_template.updated` (AD-62). Read-only `identity` module for trainer pickers
  (AD-63).

## v1.11 — Attendance & Correction Workspace · `v1.11-attendance-workspace`

- `/attendance`: day roster, one-tap attendance (offline `/commands`), bulk marking,
  correction (separate flow, mandatory reason). Optimistic UI. Added **UX-9**
  (Attendance Speed) to the Product UX Principles.

## v1.10 — Automation · `v1.10-automation`

- `apps/functions`: `on-command-created` trigger (offline attendance), nightly sweeps
  (auto-resolution → credit expiry, I-19 order), correction wiring. Grace window
  enforced in the decider (AD-60). Command envelope in `shared` (AD-58).

## v1.9 — Reservations Engine · `v1.9-reservations-engine`

- Reservation aggregate + state machine; `decideBooking` (I-9), `decideCancellation`,
  attendance/auto-resolution/correction deciders; `selectEntitlement` (I-17). Booking
  and cancellation Server Actions as cross-aggregate transactions (I-10, AD-55/56).

## v1.8 — Entitlements & the Credit Ledger · `v1.8-entitlements-credit-ledger`

- Entitlement aggregate; six-counter credit ledger (hold/release/consume/restore/
  adjust/expire/cancel) as pure deciders; purchase/adjust/cancel/expire use-cases.
  Freeze shape modelled, operations deferred (DEBT-009).

## v1.7 — Scheduling Foundation · `v1.7-scheduling-foundation`

- Services, rooms, weekly templates, dated class sessions; embedded versioned
  `SchedulingPolicy` snapshotted onto each session; eager idempotent generation.

## v1.6 — Member Management · `v1.6-member-management`

- Member CRUD; E.164 phone normalisation (unique, collisions reported); the members
  workspace. PII lives only in `/members`.

## v1.5 — Authentication & Authorization · `v1.5-authentication-authorization`

- Firebase session-cookie auth; `TenantContext` from verified claims; role guards
  (`requireTenantContext`); the tenant security-rule perimeter.

## v1.4 — Platform Foundation · `v1.4-platform-foundation`

- The shared kernel: ids, money (kuruş), time, actor taxonomy, event envelope,
  `TenantContext`, `Clock`, `Result`.

## v1.0–v1.3 — Architecture, Scaffold, Design System, Workflow

- **v1.0** Architecture v1.0 Final (docs 01–09; 46 decisions, 21 invariants).
- **v1.1** pnpm workspace scaffold (three packages).
- **v1.2** Design System v1 (semantic tokens, foundation components, mobile-first).
- **v1.3** Development Workflow v1 (milestone policy, git policy) + Product UX Principles.
