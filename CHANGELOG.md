# Changelog

Studio Operating System — Phase 1. Every milestone is a product version with a git
tag; one commit per milestone. Dates are the milestone's completion. `main` is always
in a working state (`pnpm check` green).

All notable changes are recorded here. Architecture rationale lives in
`docs/architecture/` (numbered `AD-nn`); deliberate debt in `docs/DEBT.md`.

---

## v1.25 — Notification Center · `v1.25-notification-center`

The channel the product had been missing — and the first milestone whose writes **leave the
building**. Every other write in this system is reversible inside our own database; a sent message is
not. That fact, plus two others (messages cost money per unit, and KVKK treats an operational message
and a marketing message as legally different acts), shaped the architecture more than any feature.

- **Event → Intent → Delivery Attempt.** The domain **never calls a provider**: a booking that failed
  because an SMS gateway was down would be an outage the studio never signed up for. Nothing in
  `reservations`, `finance` or `scheduling` knows this module exists — the coupling runs one way,
  downstream of the event. The **intent** is the decision to inform (audience, category, preference,
  quiet hours, deduplication); the **attempt** is plumbing. Collapsing them would put KVKK logic
  inside a retry loop.
- **Channels are independent.** In-app is `delivered` (it is a write to our own database, and it can
  honestly claim that) while e-mail is merely `sent` and SMS is still retrying. `in_app` cannot be
  switched off: it is not a message, it is her *record* of what happened to her account. She may say
  "not by SMS"; she may not say "never tell me my class was cancelled".
- **One message per operation, not twelve.** A closure that cancels twelve of a member's classes
  collapses to ONE intent by `(recipient, operationId, template)` — the third time OP-2 has paid for
  itself. At 0,15 ₺ an SMS, that is the difference between a notification system and an invoice.
- **Priority beats quiet hours** (22:00–08:00): an URGENT "dersiniz iptal edildi" goes out at 02:00;
  a NORMAL booking confirmation waits for morning. Both proven against the emulator.
- **A permanent failure is never retried.** An invalid number will still be invalid in an hour. When
  a provider will not say whether a failure is permanent, we treat it as permanent — we do not spend
  money on a guess.
- **I-38 — a notification's body and the member's address never enter the event log.** The events say
  *that* we tried, on which channel, with which template, and how it went. Content and identity live
  on the intent (erased with the member); behaviour lives in `/events` (permanent, anonymous).
- **Staff alerts are half the milestone.** A cash discrepancy reaches the **owner**; a failed delivery
  reaches **reception**, because reception is who picks up the phone. Reminders ("üyeliğiniz 3 gün
  sonra bitiyor") are **domain events** emitted by an idempotent scanner — not a cron job that reaches
  for a gateway — so they appear in her timeline and obey the same rules table.
- **Channels shipped:** in-app + e-mail. SMS, WhatsApp and push are **ports** with a mock behind them,
  so the whole pipeline is proven without a contract, a sender ID or a kuruş of SMS credit. The real
  adapter lands after Production Hardening, in one file, changing nothing else.

389 unit tests · `pnpm check` green · 16/16 emulator checks · DEBT-023 (no real e-mail transport yet),
DEBT-024 (notification settings not yet editable).

---

## v1.24 — Finance & CRM · `v1.24-finance-crm`

The milestone where the money seam closed. Before it, the system **could not represent a member who
pays half now and half next month**: `manualPayment` on the entitlement was a single record-only
field. *"Kısmi ödeme"* was never a missing screen; it was a missing model.

- **Money gets its own ledger, and the entitlement stops being where money lives.**
  `Sale → Payment → Allocation → Refund`. The allocation is the join that makes partial payment
  expressible at all: a payment may settle two sales, a sale may take five payments.
- **The cari hesap is DERIVED, never stored.** `Σ sales − Σ payments + Σ refunds`, exactly like the
  credit ledger's `available`. The balance therefore cannot be *wrong* — only a movement can, and
  every movement is an event with an actor and a reason.
- **Six invariants, and they are the same rule wearing different clothes:** a payment is never
  mutated (I-31 — a mistake is *voided*, and the void un-pays the sale it settled); a payment cannot
  pay more than it is worth (I-32); a sale never goes below zero and an over-payment becomes member
  credit (I-33); a discount is an **amount stamped at sale time**, never a percentage re-applied in
  2027 under a different rounding rule (I-34); a gift card is never spent below zero — **refused,
  never clamped** (I-35); every discretionary movement carries a reason (I-36).
- **Gün sonu.** The drawer's expected balance moves with the money, and a discrepancy is a **recorded
  fact**: the domain *refuses* to close a drawer with a difference and no explanation. A day-end that
  quietly makes the numbers agree is not a control, it is a cover-up — and the owner is precisely the
  person that control exists for.
- **Attribution, captured now.** `soldBy` / `takenBy` on every sale and payment, though commissions
  are not built: if the sale does not record who sold it, **no later engineering recovers it**.
- **CRM.** A lead is **not** a member (conversion is an explicit act that produces one and closes the
  lead); the funnel meets the ledger exactly once, when an accepted offer becomes a sale. Lost leads
  and churn carry a closed enum **and** a note — the enum makes it analysable, the note makes it true.
- **PII holds.** A lead's name and phone never enter the log; the event carries her *source*, which is
  the analysable part and the part that must survive her erasure. Interaction text stays on the
  aggregate: what a member said is hers, and the log is forever.
- **The owner's two principles, implemented.** No financial number is maintained by hand. Every money
  movement — sale, collection, refund, void, allocation, drawer open/close, coupon, gift card, lead
  conversion — appears in the Activity feed as a Turkish sentence, in the timelines, and (when
  discretionary) in the owner-only Audit Log, under one OperationId per act.

374 unit tests · `pnpm check` green · 21/21 emulator checks. Legacy money fields stay untouched and
are migrated once, with reconciliation, in v1.26 (DEBT-021).

---

## v1.23 — Owner Dashboard & Analytics · `v1.23-owner-dashboard`

The milestone that turns what v1.22 records into something a business can be run on. It writes **no
business rule**: not one event type, not one aggregate, not one decision function. Every screen
observes; the screen it links to decides.

- **The first projection in the system (D29).** Counting cannot be done on read: *"bugünkü
  rezervasyon"* is a scan that gets slower every day the studio succeeds, while a counter
  incremented once at write time never does. `onEventCreated` folds events into a per-day read
  model. Three properties make it safe to have one at all:
  - it folds **events only** — never a state document (enforced by dependency-cruiser). A projector
    that reads state produces numbers that cannot be rebuilt from the log, and a projection you
    cannot rebuild is not a cache but a second source of truth you can never reconcile;
  - it is **idempotent** — the trigger is at-least-once, and a double-counted booking is a
    *silently* wrong dashboard. The marker document and the counter move in one transaction;
  - it is **disposable** — `pnpm projections:rebuild` replays the log; `projections:verify` folds it
    independently and diffs. Neither is a migration or a backfill.

- **D24 Owner dashboard, on a widget contract** — `select()` + `present()` + `render()`. `present()`
  returns the widget's meaning as a Turkish sentence, because the AI Studio Manager will read *that*,
  not scrape a chart. `needsAttention` drives a "bugün ilgilenmen gerekenler" block: normal is quiet,
  abnormal is loud. Every card is a door — a list widget opens its own full, exportable list.

- **The owner's five definitions, implemented.** Satış ≠ tahsilat ≠ açık bakiye. An *active member*
  is an active record **with** a valid package (a record without one is a contact, not a customer).
  Occupancy is **summed booked / summed capacity** — never the average of per-session percentages,
  which lets one 1/1 PT slot outweigh a 3/20 group class. The low-credit threshold lives in studio
  settings, never in code. The empty-class alarm is the next 24 hours.

- **D25 Analytics** on its own lazy route (charts must never slow the dashboard's first paint), drawn
  by hand — a charting library is 200 kB for six bar charts. **D26–D28**: package lifecycle strip,
  feed search (member name · phone · OperationId), URL-persisted filters, one shared date-range
  vocabulary, CSV export designed as a *contract* so Excel/PDF become writers, not new screens.

- **Two real bugs, caught while building.** Money is an **object** in the log (`{amount, currency}`,
  #10) and the first projector read it as a number: it would have reported **zero revenue forever**,
  silently, without crashing. And the v1.22 presenter read `amount` where the payment payload carries
  `collectedAmount` — every payment rendered as an em dash.

- `entitlement.cancelled` gains two **additive** payload fields (`priceAgreed`, `productId`) so
  revenue can go net when a sale is reversed **without the projector ever reading state**. No version
  bump, no upcaster, no backfill: an older cancellation carries no amount and is simply not
  subtracted — we do not guess (I-30).

344 unit tests · `pnpm check` green · projection verified against the log, day for day.

---

## v1.22 — Operasyon Motoru · `v1.22-operations`

The milestone where the studio stopped being a booking screen and became an **operating system**:
the acts a studio actually performs — closing for a holiday, extending everyone's package, moving
a member's class, repeating a fixed slot, running a waiting list — and then the record of every one
of them, legible to a person who is not a developer.

It opened by fixing a defect that had been quietly burning members' credits.

- **I-27 — a cancelled class no longer consumes a credit.** `decideAutoResolution` never checked
  whether the SESSION was cancelled: the nightly sweep presumed `attended` for classes the studio
  itself had called off, and **consumed the member's credit**. The studio cancels; the member pays.
  Fixed in the domain, proven end to end, and it is now an invariant: a booked reservation on a
  cancelled session is *released*, never auto-resolved.

- **D23 Studio Calendar.** Eight day types, date and time ranges, and a Turkish holiday **provider
  port** with an adapter that computes the fixed national holidays and reads religious ones from a
  table (DEBT-017). The calendar writes **information and nothing else** — it never cancels a
  session or moves a credit. Its only bridge to an operation is a button the owner presses.

- **D21 Closure / holiday operation.** Preview → confirm → apply, with a load-bearing ordering:
  cancel the SESSION first, then its reservations, because a reservation cancelled *before* its
  session would fall inside the cancellation window and **burn the credit** (I-14). If the worker
  dies mid-run, I-27 catches the rest: the failure mode is "late", never "wrong".

- **D22 Bulk package operations.** `+gün` / `+kredi` over a chosen scope, with AD-39's mandatory
  reason + note. Frozen packages are skipped **by name**, never silently.

- **D19 Reservation move.** ONE event (`reservation.moved`) — not a cancel plus a booking. That
  distinction is load-bearing: cancel+book would inject a cancellation that never happened into the
  churn signal, release and re-hold the credit (a member with her last credit could lose the class
  between the two writes), and erase when she actually took the slot. The free-move window is the
  free-cancellation window; past it only staff may move her, and only with a written reason.

- **D18 Sabit rezervasyon.** A **generator**, not an aggregate: N weeks produce N ordinary
  reservations, each cancellable on its own. It **never invents a session** — a week the studio did
  not schedule is reported as `no_session`. Credits are consumed *as the series is planned*, so a
  member with two credits is never promised eight classes.

- **D20 Waiting list.** **I-29: waiting holds no credit.** No auto-promotion (owner): without a
  notification channel, an auto-promoted member would not know she was booked — and presumed
  attendance would then consume her credit for a class she never heard about (DEBT-018). Reception
  promotes, deliberately; the credit is held only then.

- **OP-1…OP-5 (owner, 2026-07-13).** Full timestamps to the second · one **OperationId** per
  operation, inherited by every sub-movement · mandatory reason on bulk acts · `UndoPolicy` declared
  per event type now, for v1.28 · preview → confirm → apply, forever. Architecturally the
  OperationId **is** the envelope's `correlationId`: a second id meaning the same thing would drift
  until neither could be trusted.

- **The Operations Center.** Six screens over the event log, no projection: activity feed (+ the
  dashboard's live stream), member / reservation / package timelines, operation detail (one id →
  everything it did), and an owner-only audit log with before → after (`changes[]`, additive).
  A **presenter** turns all 67 event types into Turkish sentences — a technical event name never
  reaches a screen, and an event type without a sentence fails the build. `/events` stays
  **owner-only** in the Firestore rules; every screen is fed by a Server Action with the role filter
  on the server. Reception never reads a raw event.

- **PII, held.** `changes[]` is *not* written for member profile edits: those field values ARE the
  PII, and PII never enters the log (#6). The audit shows which fields changed, never their values.

334 unit tests · `pnpm check` green · no migration, no backfill, no event version bump.

---

## v1.21 — Member Portal & Auth · `v1.21-member-portal`

The first surface a **customer** touches. Everything before this was staff-facing: if reception
mis-reads a screen, reception asks someone. A member who mis-reads a screen books the wrong class
— or sees another member's data. The bar is different, and the milestone grew to meet it.

- **The perimeter came first (D11).** Before v1.21 the Firestore rules said *any authenticated
  user in the studio may read almost everything* — safe only because every principal was staff.
  Issuing a member a `studioId` claim would have handed her every member's PII, every
  entitlement and every payment, straight from the client SDK. Reads now require a **staff**
  role; a member principal matches **no read rule at all**. The portal is server-rendered and her
  `memberId` comes only from the verified session cookie — no action takes a `memberId`, so none
  can be handed a forged one. **20 rules tests**, including every member-isolation scenario.

- **Three domain corrections the portal forced** — each an event-schema change, each with an
  upcaster, and **none with a data migration**:
  - **D12 — service-level eligibility.** `ProductSnapshot.serviceIds`, copied at purchase. A
    Reformer package no longer opens Mat Pilates just because both are `pilates_group`. Editing a
    product cannot reach a right already sold. **Entitlements sold before D12 have no list and
    keep their category-wide right** — never backfilled: *absence is the record of what was sold.*
  - **D13 — PT ownership.** `ClassSession.assignedMemberId`. `null` is an **open** slot (every
    member with a covering PT package sees and may book it, capacity permitting — a partner PT has
    capacity 2); set, it is **reserved** for one member and invisible to everyone else. Booking
    never assigns; ownership is independent of capacity; PT capacity is bounded to 1–2.
  - **D14 — the cancellation window.** Resolved through *session override → service → studio* and
    **stamped on the session at creation** (`class_session.scheduled` v3 records the value *and
    which level answered*). Changing a default never rewrites the terms a member already booked
    under. **The number six is not in the code** — it is the value a studio is provisioned with;
    if no level answers, the domain refuses rather than inventing one.

- **Portal:** invite (72 h, single-use, superseding — which is also the password-reset path) →
  activation → phone + password login → dashboard · eligibility-filtered agenda · self-booking ·
  self-cancellation showing the session's **real** window · profile (e-mail, emergency contact,
  password — the rest is never read from the request) · dynamic QR. Its own `MemberPortalShell`:
  the staff sidebar is in a different branch of the route tree and never enters her HTML.

- **QR (D10/D15/D16) — supersedes Doc 15 · D1.** The static `memberId` card is **gone**. It was a
  bearer credential with no expiry, defensible only while reception was the sole scanner; the
  portal is what made it dangerous. Replaced by a **short-lived (60 s), server-signed,
  single-use** token, verified online (signature · expiry · member · branch · not-already-used).
  Reception's **manual** check-in stays on the offline `/commands` path: the door still works
  without internet.

- **New events:** `member.invited` (the token is **never** in the payload), `member.portal_activated`,
  `member.portal_login` — the last two attributed to **the member herself**, which is the entire
  point of the actor taxonomy.

- **Defects found and fixed:** the portal login page sat inside its own auth guard and redirected
  to itself (an infinite loop for the one visitor who by definition has no session); the staff
  `AppShell` wrapped *every* route, so a member saw the owner sidebar; `recordCheckIn` never
  loaded the member, so a scanned string that was not a real member id was written as a check-in
  for a member who did not exist.

- **Debt:** DEBT-013 (QR secret has no rotation story — repay before the v1.23 cutover),
  DEBT-014 (portal has no emulator e2e suite — repay with v1.24).

`pnpm check` green (**270 tests**) · `next build` green (18 pages) · rules 20/20 · end-to-end
verification 32/32 + QR 7/7.

## v1.20 — Premium Design System & Owner UI Redesign · `v1.20-premium-design-system`

- **Design System v2.** Every owner screen rebuilt on one component system and one design
  language — Apple-simple, Linear-ordered, Stripe-professional, Notion-readable. **No
  feature, domain, event, action or behaviour changed**; presentation and information
  architecture only. Owner decisions: light-only, keep Geist, keep the teal (retuned,
  used sparingly), comfortable density with a compact toggle designed for but not built.
- **Foundation:** a deliberate type scale (display/h1/h2/h3 with size · weight ·
  line-height · tracking) and an elevation scale (hairline border + soft shadow, never a
  heavy drop-shadow), both as tokens — components still reference roles, never hex (DS-1).
- **New shared components:** `Section` (quiet grouping without another box), `Metric` /
  `MetricStrip` (a screen's headline numbers on one surface, with a `compact` size for the
  dense screens), and the house `Tabs` (both workspaces). All on `/design-system`.
- **Screens** (nine owner-reviewed batches): App Shell · Dashboard · Class Calendar ·
  Reservation Calendar · Session Workspace · Attendance · Members · Member Workspace ·
  Packages. Each keeps its data, actions and links; what changed is what you see first.
- **Information architecture,** not decoration: the dashboard reads in the order the owner
  acts (Şimdi → Bugün → Dikkat gerektirenler); the calendars gained a summary **scoped to
  the days actually on screen** (the query loads a month, so an unscoped total would lie);
  Attendance leads with the day's **Bekleyen** count; the Member Workspace surfaces a
  **balance owed the moment the member opens** (UX-8). The Members list deliberately got
  **no** metric strip — a total that changes no decision only costs space.
- **Duplication removed** (Doc 20 §7): the Member Workspace's "Paket"/"QR" quick actions
  were a second copy of the tabs one row below; the in-tab "Düzenle" and "Hızlı Rezervasyon"
  repeated the header. Every action now lives in exactly one place — no capability lost.
  On the Dashboard, the class list and the PT list had been rendering the same private
  sessions twice (`todayPt ⊂ todaySessions`): now one chronological programme with a PT tag,
  and two non-overlapping metrics.
- **Defects fixed (presentation):** `base-ui`'s `Select.Value` prints the raw value unless
  given a render function — filters showed the internal `all` sentinel and the Session
  Workspace's trainer/room pickers showed **raw ids**; both now resolve to labels. Stale
  copy ("Payments v1.19" → v1.22). `next-env.d.ts` (Next-generated) is eslint-ignored — Next
  15.5 writes a triple-slash reference into it that our own rule forbids, breaking `pnpm
  check` on a file nobody authors.
- **DEBT-012** recorded, not fixed: a stale/expired session cookie causes an infinite
  redirect loop (the middleware is a coarse gate by design, v1.5 #3, and cannot tell that a
  present cookie is invalid). Fixing it is a behaviour change, and v1.20 ships none — repay
  before the v1.23 cutover.

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
