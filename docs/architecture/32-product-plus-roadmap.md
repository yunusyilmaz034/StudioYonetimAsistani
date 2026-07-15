# 32 — Product Plus Roadmap — **the reference (LOCKED)**

**Status: LOCKED (owner, 2026-07-15).** This is to Product Plus what Doc 08 is to Phase 1: the single,
ordered source of truth for what gets built and in what order.

**Standing rules that frame everything below:**
- **`main` is frozen** — Product Alpha V1 lives on as **production**: only bug fixes, stability, and
  small operational improvements. Every large development goes to Product Plus.
- **Product Plus is a separate branch** — **`feature/product-plus`**, merged only after the pilot is
  stable.
- **The roadmap stays stable.** **A new idea does not change the roadmap — it goes into the backlog of
  the phase it belongs to.** Reordering or adding a phase is an owner decision (Doc 10).

Each phase names the backlog/architecture note that details it, and — where it matters — the **one
architectural rule that phase must not break.** The reassuring finding from the architecture review:
**every phase here is addable without touching historical data**, because the one unretrofittable
layer (event schema, actor taxonomy, category wall, policy-as-data, finance ledger) already exists.
So the risks below are *traps to avoid*, not *foundations missing*.

---

## The ten phases

### 1 — Premium UI / Design System  ·  *detail: Doc 31, vision: Doc 33*
Take the whole product to premium. **Not a colour change — every role is redesigned:** Owner,
Reception, Trainer (and Member later). Scope: a new colour system, a premium design language,
typography, a **component library** (cards · forms · dialogs · tables · charts), responsive structure,
a modern dashboard, one shared design system. **By the end of this phase the old UI is fully gone.**
- **Rule:** re-tokening + component treatment, **not** a re-architecture and **not** a colour swap.
  Values move in `globals.css` and the shared components; business screens do not change (DS-1 keeps
  hex out of screens). No feature, domain, event, or behaviour changes. Işıl approves on real screens.

### 2 — Operations Workspace  ·  *carries the shipped Doc 17 / 22 / 23 into the Plus experience*
Reception and the daily-operations centre. The reservation workspace, operations centre, bulk ops and
waitlist already shipped in Alpha; this phase **moves them into the Product Plus experience** (it is
not a rewrite): a redesigned reservation experience, fast member search, fast booking, bulk actions,
WhatsApp actions, trainer notes, room notes, the waiting list, the daily-operations screen, and
**keyboard shortcuts**.
- **Rule:** when this touches the reservation flow, lay the **rule-resolution seam**
  `resolve(memberRestriction, packageRule, studioDefault)` (Doc 30) even though enforcement is Phases
  3–4 — so Phase 4 slots in without a second rebuild of the reservation path.
- **Note:** WhatsApp here is a *channel of Phase 5*; start the Meta approval (ED-1) now — it is
  external and slow, and must not block this phase.

### 3 — Package Rules 2.0  ·  *detail: Doc 30*  ·  ✅ **CLOSED (2026-07-15, tag `plus-v0.3-package-rules`)**
Per-package rules from the catalogue: cancellation-right count (e.g. 3 / 5 / unlimited),
active-reservation limit, daily limit — **shipped and enforced** via `resolveReservationPolicy`. The
free-cancellation allowance is an entitlement ledger. Member restrictions (allowed days/hours + the
three limit overrides) shipped alongside. Late-cancel right and no-show right stayed out of scope
(future backlog). Deferred with triggers: DEBT-031 (per-booking read), DEBT-032 (move enforcement).
- **Rule:** each allowance is a **ledger, decremented by an event** (the credit-ledger discipline,
  Doc 13) — never a mutable counter, or it drifts exactly as credits would. The rule is read by the
  decider, never an `if` in a Server Action (#4).

### 4 — Member Override  ·  *detail: Doc 30*
Per-member "Kısıtlı Üyelik" on the member card: allowed days, allowed hours, max cancellations, max
active reservations — overriding the package rule for VIP / corporate / promotional / problem members.
Resolution order: **studio default → package rule → member override** (strongest last).
- **Rule:** the override *values* are member state (fine on `/members`); the override *change events*
  carry a **closed-enum reason + note**, and the note **never** enters the event payload (#6). A
  restriction with no author is the silent loosening this must not permit.

### 5 — Notification & Communication Center  ·  *extends the shipped Doc 28 / v1.25*
The core (Event → Intent → Delivery, in-app + e-mail, quiet hours) shipped in Alpha; this phase makes
it multi-channel: **WhatsApp, richer e-mail, Push notifications, campaign messages, automatic
templates.** It stays a distinct milestone because the channel and campaign surface is substantial.
- **Rule:** every channel is a **provider behind the existing port** (`NotificationProvider`); the
  center still hands over and classifies, and never claims "delivered" when it means "handed over".

### 6 — Commerce & Payments (PAYTR)  ·  *detail: Doc 27*
Real online payments, **provider confirmed: PAYTR** (owner, 2026-07-15). Scope: a **virtual POS**,
**pay-by-link**, package sales, **membership renewal**, the **wallet**, **payment history**, and the
CRM sales flow — the whole money-in surface, on the v1.24 finance spine.
- **Rule:** PAYTR is a `PaymentProvider` **behind the existing port** (Doc 26 §9) — `providerRef` on
  every payment, a webhook that confirms rather than a client that asserts. The wallet is **one payment
  method and one liability ledger** (`Sale → Payment(method) → Allocation`), never a second set of
  books. Money is integer kuruş (#10), and a confirmed payment is an event, never a client's word.

### 7 — Training & Progress  ·  *detail: Doc 25 (vision expanded below)*
A core premium module — **managing the member's development, not writing workouts.** Assign a
programme to a member; exercise video explanations; movement-level notes; a **trainer ↔ member
feedback loop**; measurements; **photo tracking**; progress charts; **programme versioning** (a
programme is never edited — every change is a new version, history kept forever).
- **Rule:** a programme **references** the exercise library and **snapshots** what it referenced at
  assignment time, so editing a library entry never rewrites a member's past programme (the same
  snapshot discipline as `SaleLine` and `productSnapshot`). Photos/measurements are member PII — they
  live on the member's records, **never in an event payload** (#6).

### 8 — Fitness Attendance  ·  *new; deliberately minimal*
A fitness check-in system, nothing more: **entry to the studio, entry history, consistency/streaks,
and usage reports.** For fitness (unlimited/period) memberships there is **no reservation and no
class**, and this **contains no training analysis** — no sets, no minutes, no machine (that is
Phase 7, a *separate module*). Attendance here means only the check-in: the date and time the member
came.
- **Rule — and this is the one to hold:** fitness attendance is a **read/report layer over existing
  `member.checked_in` events**. It **never** emits `reservation.attended` and **never** touches
  credit. The check-in ≠ attendance non-negotiable exists to protect *credit consumption*; fitness
  consumes nothing, so check-in *is* the whole signal — provided it is never dressed up as an
  attendance observation.

### 9 — Trainer Payroll  ·  *new; a money module — slow down*
Compute trainer pay from the sessions taught and the studio's rates.
- **Rule:** it reuses the **finance ledger** (Doc 26), never a parallel accounting system (the Doc 27
  warning, again). A trainer's rate is **versioned policy data**, never an `if`. And it reads the
  attendance semantics: whether a *presumed*-attended class (DEBT-007) or a no-show pays the trainer
  is a **policy decision** to settle explicitly, not a default to stumble into.

### 10 — AI Insights L1  ·  *the product vision's "Phase 2"*
The event log was built for this from day one. Nothing is built early for it.
- **Rule:** its feasibility is a **function of Phases 2–9 keeping the event discipline** — no
  presumption written as an observation (#11), no PII in an event (#6). The insight layer is only as
  trustworthy as the log beneath it, and the log is protected by every phase above.

---

## Long-term vision

**Studio Operating System** — an owner-first platform that runs daily operations, records every
meaningful business event, reduces manual work, and turns studio data into decisions. Every phase
above serves it; none of them is the product on its own.

---

## Deliberately deferred (recorded, not scheduled)

- **Campaigns / Discounts (DEBT-002).** Needed the moment the first real campaign runs (revenue
  attribution becomes a lie without it). Higher-priority modules come first (owner, 2026-07-15). When
  it lands, it attaches to the entitlement (`campaignId`, the field already exists) — no reshaping.
- **Server-side member search (DEBT-001).** Repay at ~2,000 members or the first server-search
  request; Phase 2's reservation/member search may trigger it.
- **Member portal / self-booking evolution (Doc 21).** The portal shipped; growing the member-facing
  surface is not yet a Plus phase. Revisit if the studio wants members booking themselves at scale.

---

**Related:** Doc 08 (Phase 1 roadmap — the model this follows) · Doc 10 (how milestones run) · Docs
25 / 27 / 28 / 30 / 31 (the phase details) · `docs/DEBT.md` (the deferred items' triggers).
