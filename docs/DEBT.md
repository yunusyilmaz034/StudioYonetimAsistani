# Technical Debt Register

Debt is taken **deliberately** and written down **at the moment it is taken**.

Every entry needs a **trigger to repay** — a condition, never a date. *"Someday"* is not a trigger, and debt without a trigger is not debt; it is a decision nobody made.

Not everything absent from Phase 1 is debt. **Scope** (no trainer app, no waitlist) is a decision to build later. **Debt** is a shortcut that costs something now. Only debt belongs here.

```markdown
## DEBT-nnn — Title
Taken: YYYY-MM-DD · Phase · Owner
What: one sentence.
Cost: what it costs us while it stands.
Trigger to repay: a condition.
Repayment: what we would do.
```

---

## DEBT-001 — Client-side member search

**Taken:** architecture · Phase 1 · Yunus
**What:** Firestore cannot do Turkish-collated text search (`İ`/`ı` folding). Reception's client caches the full member list and filters locally.
**Cost:** every member's PII sits in tablet memory; page load grows with member count; a stolen tablet has a wider blast radius.
**Trigger to repay:** **2,000 members**, or the first customer who asks for server-side search.
**Repayment:** Typesense or Algolia, synced from `/members` by a trigger. *(OQ-15)*

---

## DEBT-002 — No discount entity ⚠️ the one to watch

**Taken:** architecture · Phase 1 · Yunus
**What:** A discount is the gap between `productSnapshot.price` and `priceAgreed`. There is no `Discount` or `Campaign` entity.
**Cost:** none today. **The moment a campaign runs** — *"Wednesday morning 30% off"*, which is literally a suggested action on the owner's target dashboard — revenue-per-product analytics cannot distinguish a discounted sale from a cheaper product, and quietly lie.
**Trigger to repay:** **the first campaign.**
**Repayment:** `campaignId` on the entitlement (the field it attaches to already exists), a `Campaign` document, and revenue attribution in the Phase 2 projections.

---

## DEBT-003 — PII duplicated into reservation documents

**Taken:** architecture · Phase 1 · Yunus *(OQ-12, accepted with limits)*
**What:** `reservation.memberSnapshot` carries `displayName`, `phoneLast4`, `membershipStatus` so a trainer's roster costs ~10 reads instead of ~20. Built by `members.toMemberSnapshot()` — the four-field bound lives in one function *(AD-44)*.
**Cost:** a KVKK/GDPR erasure request is **not a single-document delete** — it must also purge `memberSnapshot` across that member's reservations. A rename must backfill them, via the `member.profile_updated` trigger. Bounded: never enters events, so the event log and the cross-tenant corpus stay clean.
**Trigger to repay:** if the roster stops being a hot path, or if erasure requests become frequent enough to be error-prone.
**Repayment:** render the roster from ids against the client's cached member list.

---

## DEBT-004 — `credits.available` stores derived data

**Taken:** architecture · Phase 1 · Yunus *(AD-14)*
**What:** `available = granted + restored − consumed − held − revoked − expired` is stored beside the six counters it derives from, so that *"packages expiring with unused sessions"* is an index rather than a full scan.
**Cost:** it can drift. Mitigated by writing it only inside the transaction that changes its inputs, plus a nightly consistency check that **reports and never repairs**.
**Trigger to repay:** if the nightly check ever reports a drift. A drift means a write path bypassed the transaction, and that is a bug, not a data problem.
**Repayment:** find the offending write path. The field stays.

---

## DEBT-005 — Rescheduling a class is cancel-and-rebook

**Taken:** architecture · Phase 1 · Yunus *(Doc 3 §4.4)*
**What:** `reservation.sessionStartsAt` is denormalised from the session. Sessions therefore may not move; a rescheduled class is cancelled and its members rebooked.
**Cost:** members receive a cancellation rather than a change. Acceptable — it is what they experience anyway — but it inflates `class_session.cancelled` counts in future analytics.
**Trigger to repay:** if rescheduling becomes routine, or if cancellation analytics become misleading.
**Repayment:** a `class_session.rescheduled` event and a backfill of affected reservations.

---

## DEBT-006 — Installments recorded, never processed

**Taken:** architecture · Phase 1 · Yunus
**What:** `Payment.installments` is a number we store. No payment provider is integrated; nothing is charged, scheduled, or reconciled.
**Cost:** none while payments are collected on a POS terminal outside the system. The field is documentation, not behaviour.
**Trigger to repay:** the first customer who wants the platform to **collect** money rather than record it.
**Repayment:** iyzico or PayTR — and a serious conversation about becoming a payment facilitator.

---

## DEBT-007 — Attendance is presumed, not observed ⚠️ the other one to watch

**Taken:** architecture · Phase 1 · Yunus *(E2, AD-38)*
**What:** A reservation nobody cancelled resolves to `attended` by policy default. Nobody has to watch the class for the credit ledger to settle. Manual marking exists as an override and will be used rarely.
**Cost:** **the attendance rate is an upper bound, not a measurement.** A member who books and never comes is indistinguishable from one who comes, *unless* she also fails to check in. Every Phase 2 metric that reads attendance inherits this — occupancy-vs-attendance gaps, trainer performance, churn timing.

The cost is **bounded and visible**, which is the entire reason the modelling was worth arguing about:

- `attendanceSource: 'system_default'` marks every presumed row. The fiction is queryable, not silent.
- `reservation.auto_resolved` never masquerades as `reservation.attended`, so `count(attended)` stays honest.
- `member.checked_in` gives an independent observation. *"Presumed attended, never checked in"* is computable from Phase 1 data alone.

**Trigger to repay:** when Phase 2's rules engine needs true attendance — churn prediction, trainer comparison, or a decision to charge for no-shows. Or sooner: **if the correction rate is exactly zero after two weeks**, nobody is correcting anything and the presumption has quietly become a fiction *(Doc 8, R10)*.
**Repayment:** in ascending order of cost — (1) surface *"presumed attended, never checked in"* on the reception screen so somebody looks; (2) require explicit marking for classes above a size threshold; (3) flip `policy.attendance.defaultOutcome` to `no_show`, which is a one-document change and no code at all.

---

## DEBT-008 — PT sells without trainer commission

**Taken:** architecture · Phase 1 · Yunus *(E4, AD-45, Doc 2 §13)*
**What:** PT is in the imported catalogue and sells from day one. There is no `TrainerRate`, no commission, no payroll. A PT session is a capacity-1 `ClassSession` drawn from a credit package.
**Cost:** **PT revenue attributes to the product, not to the trainer who delivered it.** Reyhan's PT income is not a number the system can produce. Reconstructing it later from `classSession.trainerId` is possible but requires that the sessions were scheduled against the right trainer, which nothing enforces today.
**Trigger to repay:** **the first commission conversation.** It will happen the first month a trainer sells more PT than she expected.
**Repayment:** a `TrainerRate` per session category, and revenue attribution in the Phase 2 projections. The `trainerId` on the session is already the join key.

---

## DEBT-009 — Freeze operations deferred (arithmetic is an open question)

**Taken:** implementation · v1.8 (entitlements) · Yunus *(Doc 2 §5.4)*
**What:** The entitlements module models `status: 'frozen'` and `FreezeState` (so I-8 holds and a reservation can refuse a frozen entitlement), but ships **no** `freeze` / `unfreeze` operations. The credit ledger — purchase, hold/release/consume/restore, adjust, expire, cancel — is complete.
**Cost:** a fitness member cannot be frozen through the system until this is built. Freeze budget (I-5), overlap (I-6), and no-freeze-in-the-past (I-7) are unenforced because there is nothing to enforce them on yet.
**Why deferred:** Doc 2 §5.4 leaves a genuine domain-arithmetic question unresolved — **is a freeze's duration fixed at freeze-time (`freeze(from, days)`, `validUntil += days` immediately) or determined at unfreeze-time (`unfreeze(to)`, `validUntil += to − from`)?** And **what happens when a member stays frozen past their budget** — auto-cap, auto-unfreeze, or refuse? This is money arithmetic and the owner's decision (CLAUDE.md: human-owned). Guessing it would bake an unrecoverable choice into events.
**Trigger to repay:** the owner resolves the two questions above **and** the first fitness member requests a freeze. Model is ready; only the operations + their events (`entitlement.frozen`, `entitlement.unfrozen`) remain.

---

## DEBT-010 — Correction re-consume direction deferred (money arithmetic)

**Taken:** implementation · v1.10 (automation) · Yunus *(Doc 14, AD-61)*
**What:** `correctReservation` wires only the credit-return direction — a *consumed*
credit is `restored` (the common, valuable case: a presumed-attended member who never
came, DEBT-007). The reverse — correcting a *released* outcome back to one that
consumes (e.g. `no_show` → `attended` where the credit was already handed back) — is
**refused** with `correction_credit_unsupported`. The `reservation.corrected` audit
event and the restore direction are complete.
**Cost:** a specific, rarer correction cannot be completed through the system. Its
audit intent is expressible but the credit cannot be re-drawn, because there is no
`held` credit to consume and no modelled movement for "consume from `available`".
Bounded: the refusal is explicit and typed, never a silent wrong ledger.
**Why deferred:** re-consuming a returned credit is genuine money arithmetic the owner
has not decided — does it draw from `available` (and refuse if zero?), or is it simply
disallowed once released? Guessing bakes an unrecoverable choice into the ledger
(CLAUDE.md: money is human-owned). Same posture as freeze (DEBT-009): model what is
safe, refuse what is unresolved.
**Trigger to repay:** the first time reception genuinely needs to overturn a released
outcome into a consuming one — **and** the owner decides the draw-from-`available`
rule.
**Repayment:** a `decideReconsume` ledger movement (or an explicit refusal rule), plus
the reverse branch in `correctReservation`.

---

## DEBT-011 — Functions emulator won't load (ESM/Node mismatch)

**Taken:** dev tooling / verification · v1.19 · Yunus
**What:** `apps/functions` is `"type": "module"` but the shared tsconfig uses
`moduleResolution: "Bundler"`, so the compiled ESM imports have no `.js` extensions and
Node's native ESM loader refuses them (`ERR_MODULE_NOT_FOUND: .../lib/scheduled/auto-check-out`).
The Functions emulator therefore fails to load its codebase; auth + firestore emulators
run fine.
**Cost:** the offline `/commands` path cannot be exercised locally — **attendance
marking** (`attendance.mark`) and **check-in** (`checkIn.record`) write their command doc
but no trigger applies it, so nothing resolves in the emulator. The UI is complete and
optimistic; synchronous paths (booking, cancel, correction, notes, week-duplication) are
unaffected. Almost certainly the same misconfiguration would break a real Functions
deploy — so this is a deploy blocker to fix before go-live, not merely a dev annoyance.
**Why deferred:** it is a functions build/deploy configuration fix (NodeNext + explicit
extensions, or a functions-only tsconfig / CommonJS output), cross-cutting and squarely in
the Production Hardening / CI milestone's scope — not v1.19 (calendars).
**Trigger to repay:** **v1.24 Production Hardening / CI** — when the emulator integration
tests must run and the Functions codebase must deploy. Fix the module config, verify
`on-command-created` + the nightly sweeps load and fire on the emulator, then run the
deferred trigger/rules/transaction integration tests.
**Repayment:** correct `apps/functions` module resolution (a functions `tsconfig` with
`module`/`moduleResolution: NodeNext` and `.js` import extensions, or CommonJS), confirm
`firebase emulators:start --only functions` loads clean, wire the integration suite.

---

## Reserved for the build week

Shortcuts taken during Phase 1 implementation get entries here **as they are taken**, not afterwards. If the cut ladder (Doc 8 §8) is used — catalogue CRUD UI, owner view, manual attendance marking, freeze UI, payment allocation UI, weekly template generation, offline check-in — each cut becomes an entry with a trigger.
