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

## Where the register stands (v1.26)

**Repaid:** DEBT-011 · 012 · 013 · 014 · 015 · 021 · 023 — the seven that stood between the product
and production. Each entry is kept, struck through with what actually happened, because **the
diagnosis is the lesson** and a register that only lists open debts teaches nothing.

**Taken in v1.26:** DEBT-025 (the command handler treats every exception as permanent).

**Open, each with a trigger that has not arrived:** 001 · 002 · 003 · 004 · 005 · 006 · 007 · 008 ·
009 · 010 · 016 · 017 · 018 · 019 · 020 · 022 · 024 · 025.

**The two to watch** are unchanged and neither is a bug: **DEBT-002** (no discount entity — it
becomes a lie the moment the first campaign runs) and **DEBT-007** (attendance is *presumed*, not
observed — every Phase 2 metric that reads attendance inherits it).

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
> **v1.26 (B5):** the cost this entry named — *"a KVKK/GDPR erasure request is **not** a single-document
> delete; it must also purge `memberSnapshot` across that member's reservations"* — is now **paid on
> demand rather than owed**: `pnpm kvkk:erase` purges it, and the erasure was rehearsed against the
> emulator. The debt stands (the duplication is still there, and a rename still has to backfill it),
> but the failure mode it warned about can no longer catch anyone out.


**Taken:** architecture · Phase 1 · Yunus *(OQ-12, accepted with limits)*
**What:** `reservation.memberSnapshot` carries `displayName`, `phoneLast4`, `membershipStatus` so a trainer's roster costs ~10 reads instead of ~20. Built by `members.toMemberSnapshot()` — the four-field bound lives in one function *(AD-44)*.
**Cost:** a KVKK/GDPR erasure request is **not a single-document delete** — it must also purge `memberSnapshot` across that member's reservations. A rename must backfill them, via the `member.profile_updated` trigger. Bounded: never enters events, so the event log and the cross-tenant corpus stay clean.
**Trigger to repay:** if the roster stops being a hot path, or if erasure requests become frequent enough to be error-prone.
**Repayment:** render the roster from ids against the client's cached member list.

---

## DEBT-004 — `credits.available` stores derived data
> **v1.26 (B3):** the nightly consistency check this entry promised now **exists** — the
> `credit_ledger_drift` signal in `apps/functions/src/scheduled/health.ts`, proven by an integration
> test that plants a drift and asserts the alarm fires **and that the number is not repaired**.
> The trigger to repay is therefore live: *if it ever reports, a write path bypassed the
> transaction, and that is a bug, not a data problem.* Runbook: `docs/RUNBOOK.md`.


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

## DEBT-009 — Freeze operations deferred (arithmetic is an open question) — ✅ **REPAID in v1.27 (S3)**

**Repaid:** 2026-07-13 · v1.27 S3 · Yunus
**The owner settled the two questions this entry existed for**, and they are now the domain:
1. **The extension happens at UNFREEZE**, by the days the membership actually stood still
   (`validUntil += to − from`). Freezing moves no date — at freeze time nobody knows how long it will
   last, and a system that guessed would have to un-guess later, in a member's favour or against it.
2. **The budget is a ceiling the system enforces.** A member who never asks to be unfrozen is
   unfrozen by the nightly sweep on the day her budget runs out, and extended by exactly the days she
   paid for. *An unlimited freeze is an unlimited membership, sold at the price of a three-month one.*
3. **A member with an upcoming booking is REFUSED**, not silently fixed — cancelling her class would
   move a credit she never asked us to move (owner: *"Hiçbir kredi veya rezervasyon otomatik
   değiştirilmesin"*).
**Nothing knows the number seven.** The budget is `product.freezeAllowanceDays`, copied onto the
entitlement at purchase — data, as the catalogue always was (#12). Pilates has none, so the domain
refuses and the screen shows no button.
**Events:** `entitlement.frozen` (moves no date) and `entitlement.unfrozen` (carries `validUntilBefore`
/ `validUntilAfter`, and `auto` — because an audit must never read as though a human decided
something the sweep did). Ten domain tests, including the owner's own worked example.

*The original entry:*

## DEBT-009 — the original

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

## DEBT-011 — Functions emulator won't load (ESM/Node mismatch) — ✅ **REPAID in v1.26 (B0)**

**Repaid:** 2026-07-13 · v1.26 · Yunus
**What it actually was:** worse than recorded. Two independent breaks, either of which alone made a
deploy impossible: (1) the ESM/`moduleResolution: Bundler` mismatch below, and (2) `@studio/core`
ships raw TypeScript (`"main": "./src/index.ts"`) as a `workspace:*` symlink that `firebase deploy`
never uploads. There was also no `predeploy` hook, so nothing compiled before a deploy at all.
**The fix:** `apps/functions/build.mjs` — esbuild bundles the domain INTO a single CJS artifact
(`lib/index.js`); only `firebase-admin` / `firebase-functions` stay external, and GCP installs those
itself. `@studio/core` moved to `devDependencies` (it is a *build-time* dependency now — leaving
`workspace:*` in the deployed manifest would break `npm install` on GCP). `predeploy` wired in
`firebase.json`; `pnpm build:functions` added to `pnpm check`, so a broken deploy now **fails the
gate** instead of passing it silently.
**Proven:** the Functions emulator loads all four definitions, and `apps/functions/test/integration/
triggers.test.ts` fires `onEventCreated` and `onCommandCreated` against the emulator.
**Two defects it surfaced on its first run:** the functions were bound to `us-central1` (see below),
and `onCommandCreated` could be killed by a poison message (DEBT-025).

*The original entry, kept because the diagnosis is the lesson:*

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

## DEBT-012 — A stale session cookie causes a redirect loop — ✅ **REPAID in v1.26 (B1)**

**Repaid:** 2026-07-13 · v1.26 · Yunus
**The fix — by deletion, not by addition.** The loop had two halves, and one of them was a
convenience: the middleware bounced any cookie-holding visitor away from `/login`. It is a COARSE
gate that cannot tell a live cookie from a dead one, so that rule was a guess dressed as a
decision. It is gone. `/login` already asks the server whether the session is *real* and redirects
a genuinely signed-in visitor itself — the same convenience, decided by the only layer that can
decide it. A member with a valid session now goes to `/portal` from there.
**Not done, deliberately:** the stale cookie is not actively cleared. It is inert — every server
read rejects it — and the next successful sign-in overwrites it. Clearing it would need a Server
Action fired from a render, which is machinery bought for a cosmetic gain.
**Proven:** `apps/web/src/middleware.test.ts` — six cases, two of which lock the loop shut.

*The original entry:*

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

## DEBT-013 — The QR signing secret is a dev constant outside production — ✅ **REPAID in v1.26 (B1)**

**Repaid:** 2026-07-13 · v1.26 · Yunus
**What was actually missing** was not rotation — it was a *home*. `QR_TOKEN_SECRET` was read by the
code and declared **nowhere**: not in `.env.example`, not in any deploy config, with a hardcoded
fallback one `NODE_ENV` away from signing real tokens with a key published in this repository. It
now lives in `server/secrets.ts` (the one place the web tier reads a secret), is provisioned from
Secret Manager via `apphosting.yaml`, and **refuses to start** a deployed environment without it —
staging included, because staging holds a copy of real members.
**Rotation — and an objection to this entry's own proposal.** DEBT-013 asked for a `kid` in the
token so two keys could be live at once. **We did not build it.** The token lives for SIXTY
SECONDS; a key id buys the ability to say *which* key signed a token and pays for it with a
permanent change to the token format. Instead: **minting uses the active key, verification accepts
a LIST** (`QR_TOKEN_SECRET` + `QR_TOKEN_SECRET_PREVIOUS`). Rotation costs zero failed scans, the
token format never changed, and the second HMAC costs nothing measurable. *The format we never
changed is the one we can never break.*
**Proven:** four rotation cases in `qr-token.test.ts`, including "refuses the outgoing key once it
is dropped" — the case that proves a rotation actually completes.

*The original entry:*

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

## DEBT-014 — The member portal has no emulator integration tests — ✅ **REPAID in v1.26 (B2)**

**Repaid:** 2026-07-13 · v1.26 · Yunus
**What shipped:** `apps/functions/test/integration/portal-e2e.test.ts` — invite → supersede →
activate → *refuse the replay* → eligibility (D12: a Reformer package does not open Mat) → book
(the credit is **held**, not consumed) → cancel inside the window (the credit comes **back**, and
`consumed` never moves). It also asserts that neither the invite token nor her phone number
reached the event log (#6).
**It builds its own fixtures** rather than leaning on the demo seed: a test that breaks when
someone edits the seed is a test nobody trusts, and one that silently stops asserting when the seed
changes shape is worse.
**Not covered, and stated plainly:** this drives the use-cases, not HTTP. A defect that lives
purely in a Server Action's wrapper — a wrong cookie read, a missing `revalidatePath` — is still
invisible to it. That is the smoke-test suite's job in B5.

*The original entry:*

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

## DEBT-015 — No test asserts the shell boundary — ✅ **REPAID in v1.26 (B2)**

**Repaid:** 2026-07-13 · v1.26 · Yunus
**What shipped:** `apps/web/src/app/shell-boundary.test.ts` — three cases asserting that the staff
`AppShell` is imported by **exactly one** layout, that nothing under `/portal` imports it, and that
the root layout (which wraps her too) does not. It runs in `pnpm check`, and now in CI.
**Deliberately a STATIC test.** A shell leak is a wiring fact, plainly visible in the import graph;
a rendering test would need a server to tell us something the source already says out loud. The
original defect — the shell sitting in `app/layout.tsx` — is caught by the third case directly.

*The original entry:*

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
strings, and that staff routes do. (This was a manual script, `tools/verify-v121.ts`, deleted at RC1 — it had not compiled since AG-1;
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
> **v1.26 (B5):** e-mail is now a REAL channel (Resend, DEBT-023), and WhatsApp is wired as a
> provider with its Meta-template mapping in place. So the trigger to repay — *"the first
> notification channel in the product"* — has arrived on the e-mail side. **Auto-promotion is still
> not built**, deliberately: it needs an offer + TTL so an unanswered promotion passes down the queue
> instead of silently booking a member who then has her credit consumed by presumed attendance
> (DEBT-007). That is a domain decision and a feature, and v1.26 ships no features.

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

## DEBT-021 — Two money models, until v1.26 — ✅ **REPAID in v1.26 (B4)**

**Repaid:** 2026-07-13 · v1.26 · Yunus
**What shipped:** `tools/migration/legacy-finance.ts` — every entitlement's v1.14 money
(`priceAgreed` / `manualPayment`) becomes a real `Sale` + `Payment` + `Allocation` in the v1.24
ledger. It calls the **real `sell()` use-case**, not hand-written events: the ledger's arithmetic
(allocation, balance, over-payment, I-32…I-35) lives in the domain, and a migration that bypasses it
to save an afternoon produces a ledger that is subtly, permanently, unverifiably wrong. The clock is
**pinned to the original purchase instant**, so revenue lands on the day it was earned.
**Idempotent:** the sale id is derived from the entitlement id, so a second run writes nothing. *A
migration that double-charges every member on its second run is one that will, once, be run twice.*
**What it surfaced:** `drawer_required` — the kasa control refusing to pretend it had been exercised
before it existed. Resolved by **AD-66** (owner): the `migration` actor is exempt; the method stays
`cash` and the drawer stays `null`, because both are *true*. Tested from both sides — a migration
may; a human still may not.
**Proven:** reconciliation fails with 7 mismatches before the run and is **clean to the kuruş**
after it. 7 sales (30.300,00 ₺), 6 payments (21.200,00 ₺), zero failures.
**Not done, deliberately:** the entitlement's money fields are **not dropped**. Expand → migrate →
**contract**, and the contract is a separate, later decision (Doc 6 §10) — data a migration both
writes and deletes on the same day is data nobody can verify.

*The original entry:*

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

## DEBT-023 — E-mail has no real transport yet — ✅ **REPAID in v1.26 (B5)**

**Repaid:** 2026-07-13 · v1.26 · Yunus
**What shipped:** `ResendEmailProvider` (owner's choice, 2026-07-13). One `fetch`, no SDK — the API
is a single POST, and a dependency here would buy retries we already have and a supply-chain risk we
do not want in the one module that talks to the outside world.
**Three properties it does not compromise on:** it reports **`sent`, never `delivered`** (Resend
accepting a message means Resend accepted it; arrival is evidence that comes later, by webhook); it
sends an **idempotency key**, because our trigger is at-least-once and a redelivery must not become a
second e-mail to a member who already got the first; and it classifies failure **conservatively** —
4xx permanent, 429/5xx transient, **anything it cannot classify is permanent**, because a retry loop
against an unknown error is money spent on a guess every fifteen minutes, forever.
**The transport is real when it is configured and honest when it is not:** with no key it falls back
to the console provider **and logs a warning on every construction**. The go/no-go checklist has a
line requiring a real e-mail in a real inbox before cutover — a studio cannot go live telling members
"we e-mailed you" while nothing was e-mailed.
**Still owed by the owner:** the Resend API key and DNS (SPF/DKIM) for `pilatesfitnessbyisil.com`.

*The original entry:*

**Taken:** 2026-07-13 · v1.25 · Yunus
**What:** `ConsoleEmailProvider` records the attempt, logs the message and reports `sent`. There is no
SMTP/SES adapter, so **no e-mail actually leaves the building** — the pipeline is real, the transport
is not. In-app is fully real (it is a write to our own database).
**Cost:** until an adapter lands, e-mail delivery is a promise the Notification Center displays but
does not keep. It is visible (status `sent`, never `delivered`), not silent.
**Trigger to repay:** before the first live customer — **v1.26 Migration & Cutover**. A studio cannot
go live telling members "we e-mailed you" when nothing was e-mailed.
**Repayment:** one `NotificationProvider` implementation. Nothing else changes; that is what the port
is for.

---

## DEBT-024 — Notification settings are defaults, not yet editable — ✅ **REPAID in v1.27 (S2)**

**Repaid:** 2026-07-13 · v1.27 S2 · Yunus
**What shipped:** quiet hours, the daily ceiling and the e-mail channel are now fields on
`/settings/studio`, edited from the settings screen, and **read by the pipeline** — both the notifier
and the retry sweep. A studio that wants a different quiet window no longer needs a deploy.
**What is deliberately NOT a switch:** `in_app`. It is not a message — it is the member's record of
what happened to her account, and `studioNotificationSettings()` forces it back on even if a stored
document has somehow lost it. *She may say "not by e-mail"; she may not say "never tell me my class
was cancelled."*
**And WhatsApp/SMS/push are not shown at all**, because they have no transport yet: a switch that
turns on a channel we cannot send is a switch that lies.

*The original entry:*

## DEBT-024 — the original

**Taken:** 2026-07-13 · v1.25 · Yunus
**What:** the daily ceiling (1000), the quiet-hour window (22:00–08:00) and the per-channel retry
policy live in `DEFAULT_NOTIFICATION_SETTINGS` / `DEFAULT_RETRY` — **as data, not as literals in an
`if`** — but there is no settings screen to change them per studio.
**Cost:** a studio that wants a different quiet window needs a deploy.
**Trigger to repay:** the second studio, or the first owner who asks.
**Repayment:** read them from `/settings/studio` (the document and the reader already exist for
`lowCreditThreshold` and `discountCeilingPercent`); add the fields to the settings dialog.

---

## DEBT-025 — The command handler treats every exception as permanent

**Taken:** 2026-07-13 · v1.26 (B0) · Yunus
**What:** `onCommandCreated` used to *throw* when a repository could not find a referenced document
("Reservation not found: …"). An unhandled throw kills the function; Firestore redelivers
at-least-once; it throws again. The command sat in `pending` **forever** and the write it carried —
a check-in, an attendance mark — vanished with nobody able to see why (Doc 8, R6). A bad QR scan was
enough to reach it. It now catches, resolves the command as `failed` with a reason, and logs loudly.
**The debt:** the handler cannot tell a *permanent* failure (a document that will never exist) from a
*transient* one (a Firestore blip). It treats both as permanent. A transient error therefore loses the
command instead of retrying it.
**Cost:** bounded and visible — the command reads `failed` with `failedReason: 'handler_error'`, which
is a queryable fact, not a silence. The alternative (retry forever) loses it *invisibly*, which is
strictly worse. And the admin SDK already retries transient gRPC failures internally, so an exception
that escapes to us has almost certainly exhausted its own retries.
**Trigger to repay:** the first `handler_error` in production that turns out to have been transient —
or, better, when the repositories stop throwing for "not found" and return a typed `DomainError`
instead. That is the real fix: a not-found is a **refusal**, not an exception, and every layer above
already speaks `Result`.
**Repayment:** typed `*_not_found` refusals at the repository boundary (with Turkish copy), then the
handler can retry an unknown exception and fail only a typed one.

---

## DEBT-026 — Revenue-per-product is not attributable from the ledger ⚠️ *(found in v1.26 final verification)*

**Taken:** 2026-07-13 · v1.26 (B6) · Yunus
**What:** `sale.created` carries `{ gross, discountTotal, total, lineCount, discountReasons,
soldByType }` — and **no product**. The projector's `salesByProduct` counter reads
`payload.productId`, which a real sale never has. It was only ever populated by the legacy
`entitlement.purchased` event.
**So the truth is worse than it looks, and it predates this milestone:** **since v1.24, no sale made
through the finance ledger has contributed to revenue-per-product.** The Analytics screen's
product-revenue figures have been showing legacy purchases only. v1.26 makes it total, because the
projector no longer folds the legacy family at all (it would double-count the migration — see Doc 29
and the `THE DOUBLE-COUNT` test).
**Cost:** *"which package earns the most?"* — a question the owner will certainly ask, and one that
Doc 24 built a chart for — cannot currently be answered from the log. Nothing is wrong; something is
absent, and the chart renders zeros rather than lying.
**Why it is not fixed here:** the fix is an **event payload change** (`sale.created` gains a `lines:
[{productId, amountKurus}]`), and an event schema is permanent and human-owned (CLAUDE.md). It is
also genuinely a design question: a sale has *many* lines, so a single `productId` does not
generalise, and the shape has to be right the first time.
**Trigger to repay:** **v1.27 Retail, Wallet & Product Sales** (owner, 2026-07-13).
**Why it waits, and why that is the right call rather than a deferral of convenience:** a *product
line* is the central concept v1.27 introduces — a retail order IS lines, with quantities, variants and
stock. Designing `sale.created`'s line shape now, against a milestone that sells only packages, would
be designing it twice: once badly, and once again in three weeks with the schema already frozen. An
event payload is permanent, so the cheap moment to get it right is the moment the domain actually has
lines in it.
**And the cost of waiting is bounded and visible:** the product-revenue chart renders zeros. It does
not lie; it is simply empty, and it says so.
**Repayment:** `sale.created` v2 with additive `lines: [{ productId, amountKurus }]` and an upcaster,
designed *with* the retail order model. The projector folds them; `pnpm projections:rebuild`.
**No backfill is possible for sales already made** — the information was never captured, and we do not
invent it (I-30). Revenue-per-product therefore begins at v1.27, honestly, rather than beginning with
a number somebody guessed.

---

## Reserved for the build week

Shortcuts taken during Phase 1 implementation get entries here **as they are taken**, not afterwards. If the cut ladder (Doc 8 §8) is used — catalogue CRUD UI, owner view, manual attendance marking, freeze UI, payment allocation UI, weekly template generation, offline check-in — each cut becomes an entry with a trigger.

---

## DEBT-027 — A package sale spans two transactions

**Taken:** Alpha Review, 2026-07-13 · **Severity:** low · **Where:** `finance/application/sell-package.ts`

Selling a package writes two aggregates: the entitlement (the package) and the ledger (the sale, the
payment, the allocation). Firestore will not commit them together without dragging one module's
documents through the other's repository, and that boundary is worth more than the convenience.

**What we did instead of a distributed transaction:**

1. **Every decider runs first, against the real drawer.** A sale that would be refused — no open till
   for a cash payment, a discount over the ceiling — is refused **before anything is written**.
2. **The grant goes first.** What is left is a vanishing race: the drawer is closed by someone else in
   the milliseconds between the two commits. The failure state is then *she has the package and
   appears to owe the full price* — **loud**, on the dashboard's "bekleyen ödemeler", and reception
   fixes it by recording the payment she has already taken.

The other order was never acceptable: sale first, grant fails, and she has **paid for nothing**, with
no screen anywhere saying so. A visible, repairable wrong state beats an invisible one, always.

**Trigger to repay:** the first time reconciliation finds one in production, or the day a second
studio makes the window matter. `pnpm migrate:reconcile` already compares entitlements against the
ledger and would find it.

---

## DEBT-028 — The gift-card balance has the bug the till just had

**Found:** Alpha stress test, 2026-07-13 · **Severity:** none *today* · **Where:** `finance/application/finance.ts`

`giftCard.redeemed` is read **outside** the transaction, incremented in memory, and the whole document
written back — the exact lost-update the cash drawer had. Two concurrent redemptions of one card would
each read the same balance, each write the same total, and **the card would be spendable twice.**

**It is not exploitable, and that is the only reason it is debt rather than a bug:** no screen can
issue a gift card. `issueGiftCardAction` is called from nowhere, so no card exists, so nothing can
redeem one. The Alpha checklist marks gift cards out of scope and they stay there.

**Trigger to repay:** **the moment a screen can issue a gift card.** Not before, and never after. The
fix is the one already written for the till — a `DrawerDelta`-shaped delta, applied inside the
transaction (`finance/infrastructure/repos.ts`). Copy it; do not invent a second one.

## DEBT-029 — `tools/` is not typechecked ✅ **REPAID — RC1, 2026-07-13**

**Was:** `pnpm typecheck` covered `packages/core`, `apps/web` and `apps/functions` — and not `tools/`.
So the scripts that touch the most dangerous things in the product (a migration, a KVKK erasure, the
break-glass tools, the verification harnesses) were the **only** code whose arguments nobody checked.
A missing argument in a Server Action is a red squiggle; the same mistake here was found by running it,
by hand, against a database.

**Repaid:** `tools/tsconfig.json` — a `noEmit` project referencing core, wired into `pnpm check` via
`typecheck:tools`. A separate project rather than folding `tools/**` into an existing one, because
core and functions are `composite` projects that EMIT, and a folder of scripts run through `tsx` has
no business in an emit graph.

**Proven, not assumed:** removing the `from` argument from `freezeEntitlement` in `verify:alpha` —
the exact mistake that used to reach the emulator — now fails at **compile time**.

**What it found on its first run**, all of it invisible until then:

- **`pnpm seed` was broken.** AG-1 made the studio-hours port a required dependency of anything that
  can create a class, and the seed was never updated. It would have thrown on the first class it
  tried to schedule. Nobody knew, because nothing looked.
- The seed had also never learned about the `notifications` block S2 added to studio settings.
- `tools/bootstrap/owner.ts` and `tools/kvkk/erase-member.ts` built a `TenantContext` with
  `role: 'platform_admin'` — **which is not a role.** It is a capability flag (Doc 1 §8); the studio
  role stays `owner` and the ACTOR carries the admin identity. The scripts worked only because the
  domain checks the actor. The type was a lie that happened to be harmless.
- Four scripts passed `{ projectId: process.env.X }` where `X` may be `undefined` — under
  `exactOptionalPropertyTypes`, an absent project and an `undefined` one are different things to the
  Admin SDK, and the second is how a break-glass script quietly talks to the wrong project.
- The monkey was minting a check-in method (`'manual'`) that does not exist.

**And what it made us admit:** nine one-off milestone probes (`verify-block1…3`, `verify-i27`,
`report-i27`, `verify-v121`, `verify-v124`, `verify-v125`, `verify-qr`) **had not compiled since
AG-1** — they would have thrown on their first line. Their job had long since been taken over by the
integration suite (35 tests), `verify:alpha`, `stress` and `monkey`. They were deleted rather than
resurrected: **a verification tool that cannot run is worse than none, because it lies.**

---

## DEBT-030 — Salon Notları sits outside the event log

**Taken:** 2026-07-15 · Product Plus Phase 2 (Operations Workspace) · Yunus (owner-approved)
**What:** A room note (`studios/{sid}/roomNotes/{id}`) is a lightweight operational annotation —
"Reformer 3 arızalı", "Salon B bugün bakımda". It is written **directly** by a Server Action, with
`active`/`resolvedAt` as mutable state and **no `room_note.opened` / `.resolved` events**. It is the
one place in the app that changes state without appending an event (non-negotiable #1), taken
deliberately because a note affects no credit, no money, and no attendance — it changes no decision
the ledger records.
**Cost:** the note's history is not in the event log. `authorId` + `createdAt` + `resolvedAt` are
kept, but a resolve overwrites rather than appends, so "who reopened this / how many times" is not
reconstructable, and the note never reaches Phase 2 projections.
**Trigger to repay:** the first time a room note must **affect a decision** — e.g. auto-blocking
bookings into an out-of-service room, or a report on room downtime. At that point it is a domain
concept, not a whiteboard.
**Repayment:** promote to a small event-sourced module (`room_note.opened` / `room_note.resolved`,
golden fixtures), reading the current collection as the seed.
