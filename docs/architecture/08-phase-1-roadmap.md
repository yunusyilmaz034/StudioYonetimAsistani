# 08 — Phase 1 Roadmap

**Status:** Draft for review
**Depends on:** [01](./01-system-architecture.md) … [07 (CLAUDE.md)](../../CLAUDE.md)
**Date:** 2026-07-09

---

## 1. What This Document Must Get Right

Every previous document answered *"what is correct?"* This one answers *"what fits in seven days?"* — and if it answers wrongly, the studio does not open on cutover Monday.

So it is written to a different standard. Where the others optimised for correctness over five years, this one optimises for **an honest estimate**, which means naming what will be cut before it is cut, and naming the one thing that can detonate the schedule.

**The constraint:** one experienced engineer, heavily AI-assisted, seven days, migrating a live studio with real members holding real prepaid credits.

**The rule that governs every trade in this document:** `Correctness > Simplicity > Maintainability > Extensibility > Performance`. **The deadline is not on that list.** If correctness and the date collide, the date moves. A studio that opens Monday with wrong credit balances is worse than a studio that opens the following Monday correctly — the first destroys member trust permanently, the second costs one week of subscription fees.

---

## 2. Definition of Done

Phase 1 is done when **reception can run her entire day** in this system and the old platform's subscription can be cancelled.

Concretely, on cutover Monday she must be able to:

1. Find a member by name or phone, in under three seconds.
2. Create a new member — with a phone that is normalised, validated, and not already taken.
3. Sell a package, a membership, or **PT** — with or without recording payment.
4. Record a payment against one or more entitlements.
5. See today's class schedule with live booked counts.
6. Book a member into a class — with the correct entitlement chosen automatically, the credit held, **her remaining balance dropping by one immediately**, and a full class refused.
7. Cancel a reservation, and see the credit returned or burned according to the six-hour policy.
8. Check a member in — **including when the wifi drops**.
9. Leave a class unmarked and trust that **the ledger settles itself** by the policy default — and mark or correct one when it matters, with a stated reason.
10. Adjust a member's credits by hand, with a reason and a note, and have it show up in her timeline.
11. See a member's credit balance and understand why it is what it is.

And the owner must be able to: **manage the product catalogue**, and see today's classes, today's and this week's collected revenue, outstanding balances, and any member's full event timeline.

**Everything else is out.** The list in §4 is not a wish list; it is a set of deliberate refusals.

---

## 3. In Scope

| Area | What ships |
|---|---|
| **Foundation** | pnpm workspace (3 packages), staging + prod Firebase projects, `pnpm check` gate, shared kernel (ids, money, time, actor, event envelope, `TenantContext`, `Clock`) |
| **Identity** | Firebase Auth, custom claims (`studioId`, `role`, `branchIds`), owner + reception roles |
| **Tenancy** | `/studios/{sid}/…` from commit #1. One studio, one branch. |
| **Catalog** | **Products are data (AD-41).** Owner UI: create, edit, deactivate, reactivate. Imported from the source, never hardcoded. **PT sells (AD-45).** |
| **Policy** | Versioned policy documents, including `attendance.defaultOutcome`. Seeded by hand, no admin UI. |
| **Members** | create, edit, deactivate, client-side search. **Phones E.164, validated (AD-40).** |
| **Entitlements** | sell, credit ledger (hold / release / consume / restore / **revoke** / expire), freeze (fitness only), admin adjustment with mandatory enum `reason` + `note` (AD-39) |
| **Scheduling** | class sessions, recurring weekly template → generated sessions, capacity-1 private sessions |
| **Reservations** | book (entitlement auto-selected, earliest-expiring-first), cancel, late-cancel, **manual attendance marking as override**, correction with reason |
| **Check-in** | reception tap → `/commands` → trigger. **Offline-capable.** |
| **Payments** | record, allocate to entitlements, `balanceDue` tracking |
| **Events** | the full Phase 1 catalogue (Doc 4 §6), written on every state change, with `correlationId` (AD-42) |
| **Scheduled jobs** | **attendance auto-resolver** (AD-38), then eager credit expiry (AD-26). In that order (I-19). |
| **Owner view** | thin, read-only: today, revenue, unpaid, member timeline. **Direct queries, no projections.** |
| **Security** | full rules + emulator tests for tenant isolation, role reads, command whitelist |
| **Migration** | export → adapter → validate → import (emitting historical events) → reconcile |

---

## 4. Explicitly Out — and When It Returns

Named so they are refusals, not oversights. **Do not partially implement any of these.**

| Not in Phase 1 | Returns | Why not now |
|---|---|---|
| Trainer app | Phase 2 | Reception marks attendance in week 1. One fewer UI, one fewer role to test. |
| Member portal / self-booking | Phase 2 | Members book by calling reception today. Replacing the *internal* workflow first is the stated goal. |
| QR self check-in | Phase 2 | Reception taps. The `method: 'qr'` enum exists; nothing produces it. |
| Projections & dashboards | Phase 2 | **Nothing reads a projection yet.** (AD-37) |
| Rules engine & insights | Phase 2 | Needs a month of real events. It will have one. |
| Waitlist, makeup sessions | Phase 2 | `waitlisted` exists in the enum. Makeup = admin credit adjustment with `reason: 'gift'`, which already works. |
| Discounts / campaigns | Phase 2 | `priceAgreed` ≠ `listPrice` already captures the discount. **The register (`DEBT-002`) tracks this — the moment a campaign runs, revenue-per-product analytics need the entity.** |
| Impersonation flow | Phase 2 | One customer; its owner is the developer. The **actor type** ships now. |
| Trainer commission on PT | Phase 2 | PT **sells** in week 1 (AD-45). PT revenue attributes to the product, not the trainer. *(DEBT-008)* |
| Product versioning | Never, probably | `productSnapshot` already freezes what was sold. Edits are in place. (Doc 2 §5.1) |
| Installment processing | Phase 3 | `Payment.installments` is recorded, never processed. |
| WhatsApp, AI, agents | Phase 3+ | Zero AI in Phase 1. Stated, and meant. |
| Server-side member search | Phase 2 | `DEBT-001`. Trigger to repay: 2,000 members. *(OQ-15)* |

---

## 5. The Export Gate — **CLOSED** (OQ-3 resolved)

The export was the single largest schedule risk in the project. It has been inspected, and the four questions are answered.

### Step 0 still stands, and it is still first

> **Export everything the incumbent platform will give you, and archive it raw to Cloud Storage, unparsed, before anything is modelled.**

Members, packages, reservations, attendance, payments, trainers — every file, every column, even the ones that look useless. **Historical attendance becomes unrecoverable the day that subscription lapses.** It is the training data for every AI capability on the roadmap. Modelling it can happen in month six; re-fetching it cannot happen at all.

Archive first. Understand second.

### The four answers

| # | Question | Answer | Consequence |
|---|---|---|---|
| **E1** | Are **remaining credits** exported explicitly? | **Yes, explicitly.** A booking deducts one credit immediately; an in-window cancellation restores it; admin may adjust either way. | **Grade A.** Import maps directly to the credit ledger. Booking → `held`; the member's `available` drops at once (Doc 2 §5.3). Admin adjustments become `entitlement.adjusted` with a closed-enum `reason` and a mandatory `note` (AD-39). |
| **E2** | Is **historical attendance** exported, and how is attendance decided? | Reservation and attendance are separate. **An uncancelled reservation counts as attended by default;** manual marking is a confirmation/override, never the primary source. | Modelled as `policy.attendance.defaultOutcome` + `reservation.auto_resolved` with `source: 'system_default'` (**AD-38**). Imported rows nobody marked carry `system_default` — because that is what is true about them. |
| **E3** | Are **phone numbers** normalisable to E.164? | Turkish local formats, inconsistent leading `0`. `05321234567` and `5321234567` both occur. | Normalise to `+905321234567` at import. **Invalid or colliding numbers block the run** and go to a validation report (**AD-40**, I-21). Never guessed, never merged. |
| **E4** | Do **package definitions** map onto a fixed product list? | **No — and they must not.** Products are created, edited, and deactivated by the owner. Current set: Pilates 8, Pilates 16, PT, Fitness 3 Months, Fitness 6 Months. | The catalogue is **data** (**AD-41**). The importer brings product definitions across from the source; **no name, price, or credit count is hardcoded.** Catalogue CRUD and PT sales enter Phase 1 (**AD-45**). |

### Grade: **A**, with one scope addition

E1 explicit, E2 unambiguous, E3 mechanically normalisable, E4 imported rather than enumerated. **Cutover stays on Day 7** — but E4 added catalogue CRUD and PT sales to a week whose Days 5–6 were already the tightest thing in this document (R3). That is paid for in §6 and hedged in §8, and it is the one place this plan got harder rather than easier.

### The grade table, kept for the next customer

| Grade | Condition | Effect |
|---|---|---|
| **A** | E1 explicit · E2 unambiguous · E3 normalisable · E4 importable | Plan as written. Cutover on Day 7. ← **customer #1 is here** |
| **B** | E1 derivable from purchases − consumption · E2 per-day only · E3 messy | **+1 day.** Cut the owner view to "today's classes + revenue" only. |
| **C** | E1 absent or untrustworthy · E2 absent | **Do not compress. Move the cutover by one week.** Credits are entered by hand from the old system's UI during the freeze window (≈300 members × 1 min ≈ 5 hours, two people). History is archived raw and imported later, or never. |

**Grade C is not a failure — it is the plan working.** The alternative is importing credit balances nobody verified, which converts a one-week delay into six months of disputes. Correctness outranks the deadline, and this is the row where that principle stops being rhetoric.

---

## 6. The Seven Days

Hours are working hours, not wall-clock. The estimates assume heavy AI assistance on implementation and **zero AI assistance on deciding what is correct** (Doc 6 §5).

### Day 1 — Archive, then foundation

| | |
|---|---|
| **AM** | **Step 0 (§5).** Export everything. Archive raw to Cloud Storage, unparsed. *(E1–E4 are already answered; this is the archive, not the gate.)* |
| **PM** | `pnpm` workspace, 3 packages. Firebase projects: staging + prod, region `eur3` / `europe-west1`. `pnpm check` gate green on an empty repo — typecheck, eslint, dependency-cruiser, vitest. |
| **PM** | Shared kernel: branded ids + prefixed ULID, `Money` (kuruş), `Instant` vs `LocalDate`, `ActorRef` (all nine variants), **the event envelope including `correlationId` and `causationId` (AD-42)**, `TenantContext`, injectable `Clock`. |

**Ends with:** a repository where the wrong thing already fails the build.

### Day 2 — The hard arithmetic

| | |
|---|---|
| **AM** | `catalog` (products as data, four events), `policy` (including `attendance.defaultOutcome`), `members` (E.164 validation, `toMemberSnapshot()`). |
| **PM** | **`entitlements`.** The credit ledger: hold / release / consume / restore / **revoke** / expire. Freeze arithmetic in calendar days. `selectEntitlement()` — earliest-expiring-first, deterministic tie-break. |
| **PM** | Table-driven domain tests **written first**. Boundaries included: exactly-6h, freeze at the validity edge, zero-credit booking, category mismatch, **an admin decrease that would go below zero (refused, not clamped)**. |

**This is the day that decides whether the product is correct.** Everything else is plumbing. Do not let it slip; do not let an agent write the test table for you — writing it *is* the specification.

**Ends with:** invariants I-1 … I-8 and I-20 passing as property tests, in milliseconds, with no emulator.

### Day 3 — Booking and attendance

| | |
|---|---|
| **AM** | `scheduling`: class sessions, weekly template → generated sessions, capacity-1 private sessions. |
| **PM** | `reservations`: `decideBooking`, `decideCancellation`, `decideAttendance`, **`decideAutoResolution`** — pure, policy-driven. Nothing knows the number six, and nothing knows that this studio presumes attendance. |
| **PM** | The booking transaction: reservation + `bookedCount` + credit hold + event, atomically. Idempotency via `commandId`. Emulator tests, including two concurrent bookings for the last seat. |

**Ends with:** I-9, I-10, I-18 proven against a real emulator. The scarce-resource path is trustworthy, and no `system` actor can emit an observation.

### Day 4 — Money, doors, and the perimeter

| | |
|---|---|
| **AM** | `payments`: record, allocate (amounts, not ids), `balanceDue`. Refund and void as new events. |
| **AM** | `checkin`: the `/commands` collection, `onCommandCreated` trigger, idempotent apply. |
| **PM** | Scheduled jobs, **in order**: `auto-resolve-attendance` then `expire-credits`, both `actor: system` (I-19). |
| **PM** | **Security rules + emulator tests.** Tenant isolation, role-scoped reads, the single `allow create` on `/commands`, events immutable. **Catalogue write authz (`owner` + `platform_admin`) is a Server Action role check, not a rule (AD-46)** — the emulator test asserts a receptionist's `create-product` call is refused, and that the rule set still has exactly one `allow create`. |

**Ends with:** the perimeter tested. A user of studio A cannot read anything of studio B, and no client can write state.

### Day 5 — Reception's day, part one

| | |
|---|---|
| **AM** | Auth, claims, `TenantContext` from session. Reception shell. |
| **AM** | Member list, client-side search, member detail with credit balance and event timeline. |
| **PM** | **Catalogue CRUD** (owner): create, edit, deactivate a product. *(E4 — the newest scope, and the first thing on the cut ladder.)* |
| **PM** | Sell entitlement, **PT included**. Record payment. Unpaid-balance warning at point of sale. |

### Day 6 — Reception's day, part two, and the dry run

| | |
|---|---|
| **AM** | Day schedule with live booked counts. Book / cancel. Class roster. **Manual attendance marking as an override** — the presumption already works without it. Check-in via `lib/commands.ts`, tested with the network switched off. |
| **PM** | **Migration: adapter → validate → import → reconcile.** Dry-run against **staging**, with the real export. Phones normalised; **invalid or colliding numbers block the run.** Products imported, not hardcoded. Reconcile every active entitlement's remaining credits against the source. Iterate until zero mismatches. |
| **PM** | Owner thin view: today, revenue, unpaid, member timeline. Direct queries. |

**The dry-run is not optional and it is not a formality.** It will find problems — E3's collisions especially — and Day 7 has no room for them.

Note the shape of Day 6's morning: because the attendance default resolves the ledger without a human, **manual marking is the one screen that can be cut without breaking anything.** That is not an accident of the UI; it is AD-38 showing up as schedule slack.

### Day 7 — Cutover

| | |
|---|---|
| **AM** | Seed production: studio, branch, staff, 5 products, policies, weekly class template. Reception trains on staging with real data. |
| **PM** | **Freeze the old system to read-only at a declared instant.** Final export. Import to production. Reconcile. **A human signs off on the credit balances, member by member.** |
| **PM** | Go / no-go (§8). |

**Ends with:** either the new system is the only writer, or you have exercised the rollback and lost nothing.

---

## 7. Cutover — Freeze and Cut

**Parallel writable operation is rejected** (AD-12). Two systems that can both check a member in produce two credit balances and no principled way to reconcile them.

```
T-0    Old system → READ-ONLY. Declared instant. Announced to staff.
       Nobody writes to it again. Ever.
T+1h   Final export. Archived raw to Cloud Storage.
T+2h   Import to production. Historical events emitted with real occurredAt,
       actor: {type:'migration', id:'import_2026_07_xx'}.
T+3h   Reconcile: every active entitlement's remaining credits vs. the source.
       Mismatches are BLOCKING, not noted.
T+4h   Human sign-off. Spot-check 20 members by phone against the old UI.
T+5h   New system is the only writer.
—      Old system stays READABLE for 4 weeks as a dispute reference,
       then is archived and cancelled.
```

### Rollback

**The window is one business day.** If the new system fails catastrophically on cutover Monday, the old platform is un-frozen, the day's transactions (a few dozen) are re-entered by hand, and the cutover is retried the following week.

After one full day of real writes, **rollback is no longer available** — the new system holds facts the old one does not. Say this out loud on Monday morning, so the decision to continue is a decision and not a drift.

### Go / no-go

Every box, or the cutover is postponed. No exceptions, no "we'll fix it Tuesday."

- [ ] Reconciliation: **zero** credit-balance mismatches
- [ ] Twenty members spot-checked by hand against the old system
- [ ] **Zero phone rows in the validation report.** Every collision resolved by a human, not by the importer *(E3)*
- [ ] **Products imported, not seeded.** `grep` the source tree for a product name and find nothing *(E4, AD-41)*
- [ ] Reception has run a full mock day on staging
- [ ] Security rules tests pass against production rules
- [ ] Offline check-in verified with the wifi physically off
- [ ] A full-class booking is refused, and the refusal is legible in Turkish
- [ ] An exactly-6-hour cancellation returns the credit
- [ ] **The attendance auto-resolver has run once on staging**: every unresolved reservation became `reservation.auto_resolved` with `source: 'system_default'`, the right credits burned, and **not one `reservation.attended` was written by the `system` actor** *(I-18)*
- [ ] **The expiry sweep ran after it**, and refused to touch any entitlement still holding a credit *(I-19)*
- [ ] Raw export archived to Cloud Storage
- [ ] Rollback rehearsed: the old system can be un-frozen in under ten minutes

---

## 8. If the Week Runs Short

It will — and E4 made it likelier, because catalogue CRUD and PT landed on the two days that were already the tightest. **Cut in this order**, and cut before the day it is needed, not during it:

1. **Catalogue CRUD UI.** The newest scope and the least load-bearing: products are *data*, and data can be seeded from the import for week one. The owner edits a product perhaps monthly. **The domain, the events, and the import stay** — only the screen goes. *(~0.5–1 day)*
2. **Owner thin view.** The owner is the developer. She can read Firestore. *(~0.5 day)*
3. **Manual attendance marking UI.** The presumption resolves every reservation without it (AD-38). Corrections go through a break-glass script that emits `reservation.corrected` with a reason. *(~0.5 day)*
4. **Freeze UI.** Freezing happens perhaps twice a month. Break-glass script, proper events. *(~0.5 day)*
5. **Payment allocation UI.** One payment = one entitlement in week one. The model supports many-to-many; the screen need not. *(~0.5 day)*
6. **Weekly template generation.** Create the week's classes with a seed script. *(~0.5 day)*
7. **Offline check-in.** Fall back to a Server Action; the `/commands` collection stays, unused. *(~1 day)* — **this is the last resort**, because it is the only cut that changes the architecture rather than the surface.

Cuts 1 and 3 are new, and both are cheap **precisely because the architecture put the behaviour in the domain and the events, not in the screen.** A cut that removes a screen is a cut you can undo in an afternoon; a cut that removes an event is one you cannot undo at all.

**Never cut:** the event log, the credit-ledger invariants, `attendanceSource`, the E.164 normalisation and its collision report, security rules tests, the reconciliation, or the human sign-off. Those cannot be added back later, and trust depends on all of them.

---

## 9. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| ~~**R1**~~ | ~~Export lacks trustworthy remaining credits~~ | — | — | **Closed.** E1 answered: credits are explicit. Grade A. |
| **R2** | Historical attendance is unavailable | Low | High *(long-term)* | Archive everything raw on Day 1. Largely closed by E2, but the archive is still the insurance. |
| **R3** | Reception UI is underfunded — Days 5–6 are the tightest, **and E4 added catalogue CRUD + PT to them** | **High** | Medium | Cut ladder §8, where catalogue CRUD is now item #1. Unstyled but correct beats pretty but wrong. |
| **R4** | Security rules take longer than half a day | Medium | High | They are on Day 4, not Day 7. The rule set is ~40 lines by design (Doc 3 §8), plus one owner-only clause for `/products`. |
| **R5** | Timezone / DST bug in freeze arithmetic | Medium | Medium | `LocalDate` and `Instant` are distinct types. The compiler is the mitigation. |
| **R6** | The command trigger dies silently; check-ins vanish | Low | High | Monitor `/commands` stuck in `pending` > 5 min from day one (Doc 6 §9). |
| **R7** | Scope creep — "while we're here, let's add the waitlist" | **High** | High | §4 is a list of refusals. The five-question gate. Say no in writing. |
| **R8** | An AI agent silently changes an event payload shape | Medium | **Critical** | Golden fixtures (AD-33). This is exactly the failure they exist to catch. |
| **R9** | *(new, E3)* Phone collisions in the export are discovered on Day 7 instead of Day 6 | Medium | High | The validation report runs in the **Day 6 dry-run**, not at cutover. A collision needs a human and a phone call, and neither is available at T+2h. |
| **R10** | *(new, E2)* Reception or a trainer believes the presumption is a *record* of attendance and stops correcting it | Medium | Medium *(compounding)* | `attendanceSource` makes the presumption visible in the UI and countable in the log. Watch the correction rate in Phase 1.5; a rate of exactly zero means nobody is looking. *(DEBT-007)* |

**R3 and R7 are now the two that actually end weeks.** R1 is closed; R3 got worse. One is a scope decision already made with eyes open, the other is internal and feels like progress while it happens.

---

## 10. Immediately After: Phase 1.5

The week after cutover is **not** the start of Phase 2. It is:

- Watching. `/commands` lag, reconciliation drift between `bookedCount` and `count(reservations)`, `credits.available` vs. its six counters, stuck triggers.
- **Watching the attendance correction rate.** If it is exactly zero after two weeks, nobody is correcting anything and the presumption has quietly become a fiction (R10, DEBT-007). If it is 30%, the default is wrong for this studio and `policy.attendance.defaultOutcome` is a one-document change.
- Fixing what reception actually complains about, which will not be what was predicted.
- Writing `docs/DEBT.md` entries for every shortcut taken during the week — **with a trigger to repay each one**.
- Letting the event log accumulate. By the end of Phase 1.5 it holds a month of real behaviour, and that is what makes Phase 2 possible.

Resist shipping features. The system is one week old and holds people's money.

---

## 11. Phase 2 Preview

Not a commitment. Written so that Phase 1's seams are aimed at something real.

1. **Projections + the rules engine (L0).** Nothing is AI. *"17 members haven't attended in 14 days."* *"Wednesday 11:00 averages 28%."* *"Reception has not checked in 3 arriving members"* — the rule that reasons about an event that did **not** happen. And the one AD-38 paid for: *"presumed attended, never checked in"* — a member drifting away while the roster says she is loyal.
2. **Trainer app.** Her classes, her rosters, her attendance. Never another trainer's occupancy.
3. **Member portal.** Web first. Self-booking, guarded by `policy.booking.allowMemberSelfBooking`.
4. **Owner dashboard.** One document read.
5. **Waitlist**, **discounts**, **impersonation**, **server-side search**, **trainer commission** — each with a trigger already recorded in `DEBT.md`.

Then, and only then, L1: read-only Turkish insights generated nightly, on top of a rules engine that has been correct for months and an event log that has been accumulating since day one.

---

## 12. Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| **AD-45** | **Phase 1 ships catalogue CRUD and sells PT.** | Seed the catalogue by hand; defer product management and PT to Phase 2 | E4 says products are administered, not enumerated, and PT is already in the incumbent's catalogue — so it will be sold in week 1 whether the plan says so or not. Better to schedule it than to discover it. The cost is real: it lands on Days 5–6 and becomes cut-ladder item #1. *(Supersedes OQ-6; amends §3, §4.)* |

---

## 13. The Honest Summary

**Seven days is achievable, and it is less comfortable than it was yesterday.**

The architecture is affordable: multi-tenant paths, the event log, the actor taxonomy, policy-as-data — these are *shape*, paid for once, on Days 1–4, and they are what make the next five years possible. E1–E4 did not change that shape. They confirmed the credit ledger, added one enum field to attendance, one normalisation rule to phones, and moved the catalogue from code into data — which is where it always belonged.

**The export is no longer the risk.** It came back Grade A, and R1 is closed. That is the single best piece of news in this document.

**The surface got tighter.** Days 5 and 6 already carried the entire reception UI plus the migration; E4 added catalogue CRUD and PT sales on top. That is the part that will hurt, and §8 exists so that the hurting is a decision rather than a panic. **Cut the catalogue screen before you cut anything else** — the products are data, the import brings them across, and a screen you can rebuild in an afternoon is not worth a cutover slipping.

Two things are now permanent that were not before, and both were nearly lost: **`attendanceSource`**, without which the no-show rate is a structural zero and the churn signal never exists; and **`correlationId`**, without which the log is rows instead of a story. Neither can be backfilled. Both cost about an hour.

The deadline will be forgotten by August. The event log will outlive it by five years.

---

## 14. Open Questions

| # | Question | Owner |
|---|---|---|
| ~~OQ-3~~ | ~~Export contents: E1–E4~~ | **Closed.** Grade A. See §5. |
| ~~OQ-6~~ | ~~Private/PT: modelled, not built~~ | **Closed.** PT sells in Phase 1. *(AD-45)* |
| **OQ-9** | Auto-check-out threshold. Suggest 4h. Not needed until occupancy is displayed (Phase 2). | Product Owner |
| **OQ-11** | Unallocated payments do not auto-allocate. | Reception UI |
| **OQ-15** | Client-side search threshold: 2,000 members, or the first customer who asks. | Phase 2 *(DEBT-001)* |
| ~~OQ-18~~ | ~~Who may write `/products`?~~ | **Closed.** `owner` + `platform_admin`, Server-Action-enforced. AD-46. |
| **OQ-4** | KVKK/GDPR: legal basis for cross-tenant learning. **Before customer #2, not before cutover.** | Counsel |
