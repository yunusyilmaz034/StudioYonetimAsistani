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

## DEBT-012 — A stale session cookie causes a redirect loop

**Taken:** 2026-07-12 · v1.20 · Yunus
**What:** the middleware is a **coarse** gate by design (v1.5 decision #3): it checks only
that the `__session` cookie is *present*, never that it is *valid*. So a cookie that no
longer verifies — expired, or issued by an Auth emulator that has since been reset — is
treated as a live session: the middleware bounces `/login` → `/`, `app/page.tsx` verifies
the cookie for real, finds nothing, redirects `/` → `/login`, and the browser ends at
`ERR_TOO_MANY_REDIRECTS`.
**Cost:** the user is locked out of the app with no way back in from inside the product —
the only escape is clearing the cookie in DevTools. Harmless in development; in production
it strands anyone whose 5-day session cookie expires while a tab is open.
**Why deferred:** the fix is an auth-flow behaviour change, and v1.20 is a presentation-only
milestone (Doc 20 §2) — no behaviour ships in it.
**Trigger to repay:** **before the first live cutover (v1.23)** — a locked-out owner on
go-live day is not an acceptable failure mode.
**Repayment:** when the server verifies the cookie and finds it invalid, **clear it** before
redirecting (delete `__session` in the redirect response, or redirect to a `/login?expired=1`
that the middleware will not bounce back). Either breaks the cycle; clearing the cookie is
the honest one, because the session really is gone.

---

## DEBT-013 — The QR signing secret is a dev constant outside production

**Taken:** 2026-07-12 · v1.21 · Yunus
**What:** the check-in token is signed with `QR_TOKEN_SECRET`. In production its absence throws;
outside production it falls back to a fixed dev string so the emulator flow is testable.
**Cost:** nothing today (the fallback cannot be reached in production). But there is no rotation
story: if the secret leaks, every outstanding token stays valid for its 60 seconds and the only
remedy is to change the env var and redeploy.
**Trigger to repay:** **v1.23 cutover** — provision a real secret, and add a `kid` to the token
so two secrets can be live at once (which is what makes rotation possible without a flag day).
**Repayment:** secret manager + key id in the payload + accept-old-verify-new during a rotation
window.

---

## DEBT-014 — The member portal has no emulator integration tests

**Taken:** 2026-07-12 · v1.21 · Yunus
**What:** invite → activation → login → book → cancel is covered by unit tests of every *rule*
(eligibility, visibility, token, claims, rules) but not by an end-to-end test against the
emulator. The Firestore **rules** are tested (20 cases, incl. every member-isolation scenario).
**Cost:** a wiring regression — a missing `await`, a wrong id, a broken transaction — would not
be caught by `pnpm check`.
**Trigger to repay:** **v1.24 Production Hardening / CI**, together with DEBT-011 (the Functions
emulator). The harness is the same one.
**Repayment:** `firebase emulators:exec` suite driving the portal's Server Actions end to end.

---

## DEBT-015 — No test asserts the shell boundary

**Taken:** 2026-07-12 · v1.21 · Yunus
**What:** the member portal rendered inside the staff `AppShell` for a full batch, and nothing
failed. `pnpm check` was green the whole time: a shell leak is invisible to typecheck, lint and
unit tests, and it was caught only by the owner looking at a screenshot.
**Cost:** the same class of bug can return silently. Today's guarantee is structural (route
groups: the staff shell is imported by exactly one layout), which is strong — but nothing *tests*
that it stays that way.
**Trigger to repay:** **v1.24 Production Hardening / CI**, or the first time anyone adds a third
shell. Whichever comes first.
**Repayment:** a render/HTTP test asserting that member routes contain no owner-navigation
strings, and that staff routes do. (This exists today as a manual script, `tools/verify-v121.ts`;
it needs to become a test that CI runs.)

---

## DEBT-016 — The closure/bulk apply runs inside the request

**Taken:** 2026-07-13 · v1.22 · Yunus
**What:** `applyClosure` / `applyBulk` iterate per-object transactions **inside the Server Action**.
The architecture (Doc 22 §6) calls for a resumable worker; today the loop is the request. A studio
closing a week with ~40 sessions / ~300 reservations / ~120 packages finishes in seconds — but the
work is bounded by the request timeout, not by a queue.
**Cost:** a very large closure (a month, a multi-branch studio) could time out mid-run. It is safe
when it does — `status` is the progress ledger, I-28 refuses a double apply, and I-27 catches any
reservation the run never reached — but the owner would see a failure and have to re-plan.
**Trigger to repay:** the first closure that exceeds ~200 sessions, or the first timeout. Whichever
comes first.
**Repayment:** move the apply loop behind `/commands` + a Functions worker; the aggregate already
carries the status ledger a worker needs.

---

## DEBT-017 — The holiday provider table is hand-maintained

**Taken:** 2026-07-13 · v1.22 · Yunus
**What:** `turkeyHolidayProvider` computes the fixed national holidays for any year, but the
**religious** holidays (Ramazan/Kurban and their arife half-days) come from a table that today
covers 2026–2027. A year outside the table imports the fixed holidays only, and says so.
**Cost:** in 2028 the owner imports an incomplete year and must add two holidays by hand. The
import is idempotent and never overwrites a manual day, so the failure mode is "missing", never
"wrong".
**Trigger to repay:** the table's last covered year enters the next 12 months.
**Repayment:** extend the table, or swap the adapter for a real source — the port
(`HolidayProvider`) exists precisely so this is a one-file change.

---

## DEBT-018 — The waiting list has no notification channel

**Taken:** 2026-07-13 · v1.22 · Yunus
**What:** D20 ships without auto-promotion *on purpose* — an auto-promoted member who was never
told would have her credit consumed by presumed attendance (DEBT-007) for a class she did not
know she had. Today reception promotes and tells her by hand. There is no SMS/push/e-mail.
**Cost:** promotion depends on a human noticing the free seat. A queue can sit while a seat stays
empty.
**Trigger to repay:** the first notification channel (SMS or push) in the product.
**Repayment:** auto-promotion behind a policy flag, plus an offer + TTL (the doc reserves both,
Doc 22 §4) so an unanswered offer passes down the queue instead of silently booking her.

---

## DEBT-019 — A recurring series has no handle

**Taken:** 2026-07-13 · v1.22 · Yunus
**What:** D18 is a GENERATOR (owner-approved): eight weeks produce eight ordinary reservations, all
sharing one OperationId, and nothing stands over them. "Cancel the whole series" therefore means
"cancel eight reservations", one by one.
**Cost:** a member who quits mid-term needs eight cancellations, not one.
**Trigger to repay:** the first time reception asks for it, or v1.28 Undo — whichever comes first.
**Repayment:** an "undo this operation" acting on the OperationId (OP-2/OP-4). The seam is already
there: every booking in the series carries the id, and `reservation.booked` is `compensating`.

---

## DEBT-020 — The dashboard's member-level lists are computed in memory

**Taken:** 2026-07-13 · v1.23 · Yunus
**What:** "aktif üye", "kredisi azalan", "kredisi biten" and "süresi bitecek" are derived by reading
**every active entitlement** (`listActive`) and the member list, then filtering in memory. At one
studio that is a few hundred rows and two reads; it is bounded, and it is not an N+1.
**Cost:** at thousands of active packages it becomes a read the dashboard pays for on every open.
**Trigger to repay:** the first studio with >2,000 active entitlements, or the first time the
dashboard's read latency is measurably slow.
**Repayment:** query directly — `credits.available` is already denormalised on the entitlement
(AD-14) and `validUntil` is indexable; two `where` clauses replace the in-memory filter. Deliberately
not done now: the index set is a cost too, and optimising an unmeasured read is debt in costume.

---

## DEBT-021 — Two money models, until v1.26

**Taken:** 2026-07-13 · v1.24 · Yunus
**What:** the finance ledger (Sale · Payment · Allocation) is authoritative from v1.24, but every
entitlement sold before it still carries the v1.14 fields (`priceAgreed`, `paidTotal`,
`manualPayment`). The owner decided (decision 1) to MIGRATE — once, with reconciliation, in v1.26 —
rather than carry a read-side `if (legacy)` forever.
**Cost:** until then, a member's cari hesap covers only what was sold through the new ledger. The
member workspace shows both (packages tab: legacy; cari hesap tab: the ledger), and the dashboard's
sales/collections figures fold both event families.
**Trigger to repay:** **v1.26 Migration, Cutover & Production Hardening** — the milestone that
already owns import + reconcile + cutover.
**Repayment:** emit historical `sale.created` / `payment.received` from the existing entitlements
(`actor: system`, `source: 'migration'`, original `occurredAt`), reconcile totals, then drop the
entitlement's money fields.

---

## DEBT-022 — The instalment plan does not yet mark itself paid

**Taken:** 2026-07-13 · v1.24 · Yunus
**What:** a payment plan records the promises (due dates + amounts) and the ledger records the money,
but nothing yet links a `payment.received` back to the instalment it satisfied — `plan.instalment_paid`
is declared and unemitted.
**Cost:** "bekleyen ödemeler" is honest (it reads the sale's balance), but the instalment list shows
every instalment as `due` even after the money arrives.
**Trigger to repay:** the first studio that actually sells an instalment plan, or v1.25 (reminders
need to know which instalment is late).
**Repayment:** on allocation, match the amount to the earliest unpaid instalment of the sale's plan
and emit `plan.instalment_paid` in the same transaction.

---

## Reserved for the build week

Shortcuts taken during Phase 1 implementation get entries here **as they are taken**, not afterwards. If the cut ladder (Doc 8 §8) is used — catalogue CRUD UI, owner view, manual attendance marking, freeze UI, payment allocation UI, weekly template generation, offline check-in — each cut becomes an entry with a trigger.
