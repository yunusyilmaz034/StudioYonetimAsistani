# 06 — Development Principles

**Status:** Draft for review
**Depends on:** [01](./01-system-architecture.md) … [05](./05-folder-structure.md)
**Date:** 2026-07-09

---

## Prime Directives

These outrank everything else in this document. When any two principles collide, resolve in this order.

### The priority order

```
1. Correctness      ← never sacrificed. Not for speed, not for elegance, not for the deadline.
2. Simplicity
3. Maintainability
4. Extensibility
5. Performance      ← last. Optimise only after measuring.
```

**Correctness is never traded for performance.** A dashboard that loads in 80 ms and reports the wrong credit balance is worse than no dashboard: it converts a member's dispute into the owner's confusion.

**Prefer simple over clever.** Clever code is written once and read for five years, by a solo developer and by agents with no memory of why it was clever.

**No premature optimisation.** A denormalised field justified by *correctness* (`bookedCount` makes "the last seat" mean something; `credits.available` makes an index possible) is architecture. A denormalised field justified by *unmeasured speed* is debt wearing architecture's clothes. **Ask which one it is, every time.**

### Phase discipline

> **Never implement a future phase early. Design the extension point, and stop.**

The distinction is precise, and it is the difference between foresight and waste:

| This is a **seam** — build it now | This is an **implementation** — do not |
|---|---|
| `ai_agent` exists in the actor union | An AI agent that acts |
| `waitlisted` exists in the reservation enum | Waitlist promotion logic |
| `insight.acted_on` is a declared event type | An insight engine |
| Events carry `occurredAt` separate from `recordedAt` | A door sensor |
| Events carry `causationId`, always `null` today | A projector that emits events |
| `attendanceSource` distinguishes a presumption from an observation | A churn model that reads it |

**`policy.aiFences` is not on the left.** A policy is a *versioned document*, so a field added in Phase 3 never touches history — it fails the test below, and it was cut (AD-37). That is the whole discipline in one row: a seam is not "something the future will want," it is "something the future cannot have unless we act now."

The test: **can this be added later without touching historical data?**

- Actor taxonomy: **no** — it cannot be retrofitted onto events already written. Build the seam now.
- AI behaviour: **yes** — always addable. Build nothing.

That asymmetry is the entire justification for every "future" artefact in this architecture. Anything that fails the test is scope creep, and gets cut.

### Challenge the feature

When a feature is proposed — by the owner, by a user, by me, by an agent — the first question is:

> **Does this solve a real operational problem?**

If not, **challenge it before implementing it.** A feature that does not change a decision someone makes is a feature that adds surface area, tests, documentation, and bugs, in exchange for nothing.

This applies with particular force to the owner's dashboard. A metric that does not change a decision is a number nobody looks at twice.

---

## 1. Who This Is For

One experienced engineer, writing most of the code through AI agents, shipping to a real studio with real members and real money in seven days, and maintaining it for five years.

That combination is unusual, and it inverts the normal advice.

**A conventional team's principles optimise for communication between people.** Ours optimise for something else: an AI agent will read this repository with no memory of yesterday, propose a plausible change, and be confidently wrong in ways that are expensive and quiet. Meanwhile the human reviewing it is the same person who wrote the prompt, at 1 a.m., wanting to ship.

So the principles below are not aspirations. They are **the load-bearing structure that makes AI-assisted development safe on a system that holds people's money.**

---

## 2. The Hierarchy of Truth

When two things disagree, this is the order:

```
1. Invariants        (Doc 2 §15)   — if these break, the business is wrong
2. Events            (Doc 4)       — what happened. Immutable. Unrecoverable if unrecorded.
3. State documents                 — a cache of the events, fast to read
4. Projections                     — disposable. Rebuild them.
5. UI                              — the cheapest thing in the repository
```

Read it downward: **anything below may be rebuilt from anything above.** Nothing above may be repaired from below.

The practical consequence is a reflex. When a bug appears — a wrong credit balance, a stale dashboard — the question is never *"how do I fix this document?"* It is *"which layer is lying, and what does the layer above it say?"*

---

## 3. The Twelve Non-Negotiables

These are quoted verbatim in `CLAUDE.md`. Violating one is not a style disagreement; it is a defect.

1. **Every state change appends an event, in the same transaction as the state write.** If they can drift, the log is decorative.
2. **The producer never appears in the event type.** A door sensor emits `branch.opened`, not `device.door_opened`. *(D1)*
3. **Two timestamps.** `occurredAt` is domain time. `recordedAt` is `serverTimestamp()`. They are never the same field. *(D2)*
4. **Policy is versioned data, never an `if`.** Every credit-affecting decision stamps the version it was judged under. *(D3)*
5. **Every actor is a principal.** No AI agent, no background job, no migration script ever borrows a human's identity. *(D4)*
6. **PII never enters an event payload.** Identity lives in `/members`; behaviour lives in events. *(AD-10 — and it is what makes erasure possible at all)*
7. **Decision functions are pure.** No I/O, no `Date.now()`, no `Math.random()`. `(state, policy, command, now) → events`.
8. **Clients read state and write commands. Clients never write state.** *(AD-15)*
9. **Corrections are compensating events.** Never a silent overwrite. `reason` is mandatory and enforced in the domain, not the UI.
10. **Money is an integer in kuruş.** A float in a money path is a bug, not a rounding preference.
11. **A presumption is never written down as an observation.** The `system` actor emits `reservation.auto_resolved`, never `reservation.attended`. *(AD-38 — the credit consequence is identical; the epistemics are not, and only one of them is recoverable.)*
12. **The catalogue is data.** No product name, price, or credit count appears in a source file. *(AD-41)*

---

## 4. The Five-Question Gate

Before any non-trivial change — a new dependency, a new collection, a new abstraction, a new package — it passes this gate. Out loud, in the pull request or the commit body:

0. **Does it solve a real operational problem?** *(If not — challenge it. Do not build it.)*
1. **Does it serve the product vision?** *(Does it change a decision the owner makes? If not, why is it here?)*
2. **Is it sustainable in five years?**
3. **Is it more complex than Phase 1 requires?** *(Is it a seam, or a future phase implemented early?)*
4. **Can one developer maintain it?**
5. **Is it good for AI-assisted development?** *(Can an agent do the wrong thing here without a build failure?)*

**If any answer is no, stop and propose the alternative.** This applies to me as much as to a human. Two decisions in this architecture were overturned by this gate after they were already written down — nested branch collections (AD-13) and the eight-package monorepo (AD-27). Catching them on paper cost an hour; catching them in production would have cost a migration.

---

## 5. Working With AI Agents

The central asymmetry: **an agent writes code faster than a human can review it, and its mistakes are syntactically beautiful.**

### What agents do well here, and why the architecture is shaped for it

Vertical module slices (AD-28), a single public door per module (AD-29), an executable dependency graph (AD-30), golden fixtures (AD-33), and a module `README.md` naming its invariants (AD-34) exist *because* an agent will otherwise: put domain logic in a React component, import `firebase-admin` into a pure function, add a field to an event payload without a version bump, and reach into another module's internals — each time producing code that passes, works, and is wrong.

Every one of those is now a build failure.

### What is never delegated

| Delegate to an agent | The human owns |
|---|---|
| Implementing a decision function against a written spec | **Deciding what the invariant is** |
| Writing table-driven tests for known cases | **Naming the cases that must be refused** |
| Repositories, mappers, UI, plumbing | **Event schema changes** — permanent, unrecoverable |
| Refactors inside a module | **Anything that touches migration or money** |
| Docs, comments, commit messages | **The five-question gate** |

**Event schemas and credit arithmetic are the two places to slow down.** Everything else is recoverable by rewriting it.

### The prompt discipline

A prompt that says *"add waitlist support"* invites the agent to invent a design. A prompt that says *"implement `decidePromotion()` per Doc 5 §11, steps 1–5; the golden fixture already exists"* invites it to do exactly one thing.

**Point agents at the recipe (Doc 5 §11) and the module README, not at the whole repository.** Context is not free, and an agent given the whole system will helpfully improve parts of it you did not ask about.

### The review checklist

Read the diff and answer, every time:

- Did an event schema change? → **Stop. Is there a version bump and an upcaster?**
- Did a `domain/` file gain an import? → Is it pure?
- Did a Server Action grow an `if`? → The logic belongs in `core`.
- Is there a `Date.now()` anywhere? → Lint should have caught it; why didn't it?
- Is a number holding money? → Is it kuruş, and is it branded?
- Did a projection get repaired instead of rebuilt?
- Is there a new denormalised field? → **Is it in the register (Doc 3 §6)?**
- Does a `system` actor emit an event that claims somebody *observed* something? → **AD-38. It may not.**
- Is a product name, price, or credit count written in a source file? → **AD-41. The catalogue is data.**

`pnpm check` catches most of this. **The list exists for what lint cannot see**, and it is short enough to actually run.

---

## 6. Testing

The pyramid is inverted deliberately (Doc 5 §8). The hard part of this system is arithmetic over entitlements, not Firestore.

### Test-first, but only where it pays

**Domain decision functions are written test-first.** Not because TDD is virtuous, but because the specification *is* a table of cases, and writing the table first is how the edge cases get named before the implementation talks you out of them:

```ts
describe('decideCancellation', () => {
  const cases = [
    ['6h 1m before, pilates',      { hours: 6.02 }, ['reservation.cancelled', 'entitlement.credit_released']],
    ['exactly 6h before',          { hours: 6.00 }, ['reservation.cancelled', 'entitlement.credit_released']],  // ⚠ boundary: inclusive
    ['5h 59m before',              { hours: 5.98 }, ['reservation.late_cancelled', 'entitlement.credit_consumed']],
    ['class already cancelled',    { classCancelled: true }, ['entitlement.credit_released']],   // always refund
    ['late, policy does not burn', { hours: 1, burns: false }, ['reservation.late_cancelled']],
    ['after class started',        { hours: -0.5 }, ['DomainError: cannot cancel a started class']],
  ]
})
```

That `exactly 6h` row is the one a human forgets and an agent guesses at. **It is worth more than the implementation.**

Everything else — repositories, mappers, UI, triggers — is tested where it is cheap and skipped where it is not. There is no coverage target. **A coverage target on a solo project is a mechanism for writing tests about getters.**

### The four suites

| Suite | Emulator | Proves |
|---|---|---|
| `domain/**/*.test.ts` | ❌ | The credit and freeze arithmetic |
| `test/invariants/` | ❌ | Doc 2's twenty-one invariants over random command sequences |
| `test/golden/` | ❌ | **Event payloads cannot drift accidentally** |
| `test/integration/` | ✅ | Transactions, security rules, triggers |

**Security rules get tests.** They are the tenant boundary, and the emulator's rules-testing harness is the only thing standing between studio #1 and studio #47's member list. At minimum: a user of studio A cannot read *anything* under studio B; a trainer cannot read `/events`; a client cannot write anything but `/commands`; a client cannot create a command with someone else's `actor.id`.

---

## 7. Errors

Two kinds, handled differently.

**Domain errors are values.** A booking refused because the class is full is not exceptional — it is the system working. It returns a typed result the UI can render in Turkish.

```ts
type DomainError =
  | { code: 'class_full'; capacity: number }
  | { code: 'insufficient_credits'; available: number }
  | { code: 'entitlement_frozen'; unfreezesAt: Instant }
  | { code: 'entitlement_expired'; expiredAt: Instant }
  | { code: 'category_mismatch'; required: Category }        // the category wall, I-9.7
  | { code: 'outside_validity'; validUntil: Instant }
  | { code: 'reason_required' }
  | { code: 'note_required' }                                // AD-39 — an enum is not an explanation
  | { code: 'adjustment_below_zero'; available: number; delta: number }   // I-1 — refuse, never clamp
  | { code: 'invalid_phone'; value: string }                 // I-21 — never guessed at
  | { code: 'phone_already_registered'; memberId: MemberId } // I-21 — reported, never merged
```

**Infrastructure errors are thrown.** Firestore is down, the transaction failed, a token expired. Nobody writes an `if` for these; they bubble, they are logged with the `correlationId`, and the UI says something honest.

The distinction matters because **a domain error must be renderable to a receptionist standing in front of a member.** *"Bu ders dolu (8/8)"* is a sentence. *"FAILED_PRECONDITION"* is not.

Every `DomainError` code maps to exactly one Turkish message, in one file. The domain layer never contains a Turkish string.

---

## 8. Validation

**Zod at the boundary. Never in the domain.**

```
untrusted input → zod.parse() → typed command → domain (already valid, by type)
```

A decision function that re-validates its inputs is a function that does not trust its types, and it will accrete defensive checks until the invariants are impossible to find. Parse once, at the door: Server Action inputs, `/commands` payloads before the trigger applies them, migration rows.

**Client-supplied `occurredAt` is untrusted** even after parsing. It is clamped to a sane window around server time (Doc 1 §9). A receptionist may record a door that opened fifteen minutes ago. She may not record one that opens tomorrow.

---

## 9. Observability

Structured logs, always with `correlationId`, `studioId`, `actor.type`. **Never with PII** — the same discipline as event payloads, for the same reason: logs are exported, aggregated, and read by people who have no business knowing a member's phone number.

```ts
log.info('reservation.booked', {
  correlationId, studioId, memberId,      // opaque id ✅
  classSessionId, creditsAvailableAfter,
})                                         // memberName ❌ never
```

**Three things must be monitored from day one**, because each fails silently:

| Signal | Why it is silent | Alert |
|---|---|---|
| `/commands` stuck in `pending` | The trigger died. Check-ins vanish. Reception notices nothing. | > 5 min old |
| Projection watermark lag | The dashboard is stale but confidently rendered. | > 1 h behind |
| `bookedCount` vs. `count(reservations)` drift | Bookings silently over- or under-sell a class. | nightly, report only |
| `credits.available` vs. its six counters | A write path bypassed the transaction. *(DEBT-004)* | nightly, report only |
| An entitlement at `validUntil` with `held > 0` | The expiry sweep would burn a credit a class is about to consume. *(I-19)* | nightly, **block the sweep for that row** |

**The drift check reports; it never repairs.** A self-healing system hides its bugs, and the bug is the thing you need to know about.

---

## 10. Data Changes in Production

Real members. Real money. A one-week-old system.

**Expand, migrate, contract — never a destructive change.**
1. Add the new field, nullable. Deploy. Both shapes exist.
2. Backfill via a script that **emits events** where the change is domain-significant.
3. Switch reads. Deploy.
4. Remove the old field, much later, if ever.

**Never edit production data by hand.** Not through the Firebase console, not through a REPL. A credit that changes without an event is a credit nobody can explain — and the member who disputes it will be right and unanswerable.

When production data must change, it changes through a **break-glass script** that runs the same command handlers, with `actor: {type:'platform_admin', id: …}` and a mandatory `reason`. The event log then contains the intervention, which is exactly what an audit is for.

**The Firebase console is read-only.** Treat write access there as a production incident waiting for an author.

---

## 11. Cost Discipline

Firestore bills reads. Cost is a design property, not an optimisation phase (Doc 3 §11).

**Every screen has a read budget, declared before it is built:**

| Screen | Budget | Enforced by |
|---|---|---|
| Owner dashboard | **1 read** | it is one projection document |
| Reception day view | ~15 | one day of sessions |
| Trainer roster | ~10 | `memberSnapshot` denormalised — zero member reads |
| Member profile | ~5 | member + entitlements + recent reservations |

**A screen that exceeds its budget is a design bug, not a performance bug.** The remedy is a projection, not a cache.

The pathological alternative is not hypothetical: fifteen aggregation queries per dashboard load, times a thousand studios, times a nervous owner refreshing, is the difference between a $20/month platform and a $2,000/month one — and it is a schema decision, made once, not something to fix later.

---

## 12. Security Posture

- **Security rules are the perimeter, not a suggestion.** Every collection defaults to deny. The rule set has exactly one `allow create` in it (Doc 3 §8), and it is small enough for one person to audit in five minutes.
- **`studioId` comes from the token. Never from client input.** A `TenantContext` is constructed by the server, from claims, and passed down. A repository that accepts a raw path is a defect.
- **Rules are not filters.** A `list` query must carry its own constraining `where` clause. The repository adds it, not the UI.
- **No collection-group queries.** *(AD-17)* They are how a tenant-scoped schema grows a cross-tenant read path.
- **Impersonation is visible to the customer.** It emits events into their log.
- **Secrets in Secret Manager.** Never in `.env` committed, never in a Cloud Function's environment where a stack trace can print it.

---

## 13. Git

Trunk-based. Small commits. English messages, Conventional Commits, scoped by module:

```
feat(entitlements): add freeze arithmetic with calendar-day handling
fix(reservations): treat exactly-6h cancellation as within window
docs(architecture): overturn AD-4, branches are a field not a path
chore(deps): pin firebase-admin
```

**A commit that changes an event schema says so in the subject line**, because it is the one class of change that cannot be undone by a revert:

```
feat(events)!: bump reservation.booked to v2, add categoryMatched
```

`pnpm check` runs pre-commit. It takes seconds, on purpose (Doc 5 §9). A gate that takes two minutes gets skipped, by a tired human and by an agent told to make the tests pass.

---

## 14. Documentation

Three kinds, each with a job:

| Where | What | When it is written |
|---|---|---|
| `docs/architecture/` | **Why.** Decisions, alternatives rejected, and the reasoning. | Before the code |
| `modules/*/README.md` | Purpose, public API, **the invariants this module owns** | With the module |
| Code comments | Only what the code cannot say: a policy constraint, a Firestore quirk, a boundary case | Sparingly |

**A comment that says what the next line does is noise.** A comment that says *"Firestore requires all reads before any write in a transaction"* is load-bearing, because the next person — human or agent — will otherwise reorder it and break it subtly.

**Decisions get an `AD-nn` and live in `docs/`.** Forty-five of them exist already. When a future session asks *"why is branchId a field and not a path?"*, the answer is AD-13, with the alternative that was rejected and the reason. **This is the single highest-value artefact for AI-assisted development**, because an agent that cannot find the reasoning will re-derive it — differently.

---

## 15. Technical Debt Register

Debt is taken deliberately and **written down at the moment it is taken**, in `docs/DEBT.md`:

```markdown
## DEBT-001 — Client-side member search
Taken: 2026-07-12 · Phase 1 · Owner: Yunus
Firestore cannot do Turkish-collated text search. Reception caches the full
member list and filters locally.
Cost: entire member PII in tablet memory; page load grows with member count.
Trigger to repay: 2,000 members, or the first customer who asks. (OQ-15)
Repayment: Typesense or Algolia, Phase 2.
```

Every entry needs a **trigger to repay** — a condition, not a date. *"Someday"* is not a trigger, and debt without a trigger is not debt; it is a decision nobody made.

Known entries at architecture time: client-side search (DEBT-001), no discount entity (DEBT-002 — **the one to watch**, since revenue-per-product analytics quietly lie the moment a campaign runs), PII in reservations (DEBT-003), stored `credits.available` (DEBT-004), cancel-and-rebook rescheduling (DEBT-005), unprocessed installments (DEBT-006), **presumed attendance** (DEBT-007), **PT without trainer commission** (DEBT-008).

---

## 16. When to Break These Rules

Rules that cannot be broken get worked around silently, which is worse.

**Any rule here may be broken if the reason is written down** — in `docs/DEBT.md`, or as an `AD-nn` if it is permanent. Two rules already were: `reservation.memberSnapshot` puts PII in a non-member document (OQ-12), and `credits.available` stores derived data (AD-14). Both are documented, bounded, and defensible.

The four that stay unbreakable, because breaking them is unrecoverable rather than merely costly:

1. **An event, once written, is never mutated or deleted.**
2. **PII never enters an event payload.**
3. **State and its event commit in the same transaction.**
4. **A presumption is never recorded as an observation.** *(AD-38)*

The fourth joined the list after E2. It looks like a modelling nicety and it is not: `attendanceSource` cannot be backfilled, and without it the no-show rate is a structural zero forever. That is the shape of every entry here — cheap today, impossible tomorrow.

Everything else is a trade you may make with your eyes open.

---

## 17. Definition of Done

A change is done when:

- [ ] It solves a real operational problem, and belongs to **this** phase — not a later one implemented early
- [ ] `pnpm check` passes (typecheck, lint, dependency-cruiser, unit tests)
- [ ] Domain logic is pure and covered by table-driven tests, boundaries included
- [ ] New events have golden fixtures; changed events have a version bump **and** an upcaster
- [ ] New denormalised fields are in the register (Doc 3 §6) with a rebuild path
- [ ] Security rules updated **and tested** if a collection changed
- [ ] The screen's read budget is respected
- [ ] Turkish user-facing copy exists for every new `DomainError`
- [ ] Debt, if taken, is in `DEBT.md` with a trigger to repay
- [ ] The five-question gate was answered, and the answer is in the commit body

Ten boxes. Long enough to be honest, short enough to actually run at 1 a.m. — which is when it matters, because that is when the shortcuts get taken.
