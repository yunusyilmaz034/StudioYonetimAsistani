# 05 — Folder Structure

**Status:** Draft for review
**Depends on:** [01](./01-system-architecture.md) … [04](./04-event-model.md)
**Date:** 2026-07-09

---

## 1. The Constraint That Decides Everything

One developer. Heavily AI-assisted. One week to production.

That is not a footnote to the folder structure — **it is the folder structure.** A layout optimised for a ten-person team is a layout that punishes a solo developer with ceremony. A layout optimised for "move fast" is one that an AI coding agent will happily turn into a ball of mud at 2 a.m., because nothing stopped it.

The target is narrow: **a structure where the wrong thing is hard to write, and the right thing is obvious to both a human and a language model.**

Three properties, in priority order:

1. **Boundaries are mechanically enforced.** Not by convention, not by a code-review culture of one. By lint rules that fail the build.
2. **Every module is a vertical slice with one public door.** An AI agent asked to "add waitlist support" should find every relevant file in one directory and be unable to reach into another module's internals.
3. **The domain layer is framework-free and emulator-free.** It is the only part with hard logic, and its tests must run in milliseconds.

---

## 2. Running the Five-Question Filter

The tempting structure is a monorepo with six packages. Let me test it before proposing it.

| Question | `pnpm` workspace, 4 packages | Single Next.js app, `functions/` beside it |
|---|---|---|
| **Fits the product vision?** | ✅ Flutter (Phase 2) and Cloud Functions both consume `core` unchanged | ⚠️ Next.js becomes the gravity well; logic leaks into Server Actions |
| **Sustainable in 5 years?** | ✅ `core` outlives every frontend it has | ❌ Rewriting the frontend means re-extracting the domain |
| **Over-engineered for Phase 1?** | ⚠️ Costs ~2 hours of setup and one class of confusing build errors | ✅ Zero setup |
| **Manageable by one developer?** | ✅ if kept to **4** packages. ❌ at eight. | ✅ |
| **Good for AI-assisted development?** | ✅ boundaries are machine-checkable; agent can't drift | ❌ agent will put domain logic in a React component, plausibly, and be right that it "works" |

**Verdict: pnpm workspace, exactly three packages.** The two hours are bought back the first time an AI agent tries to import `firebase-admin` into a pure decision function and the lint rule stops it.

**The failure mode I am explicitly avoiding:** the eight-package monorepo (`@studio/money`, `@studio/ids`, `@studio/result`, …). Each split is individually defensible and collectively they produce a build graph that a solo developer spends more time maintaining than the product. **When a fourth package is proposed, the burden of proof is on the fourth.**

That burden was applied to my own first draft, which proposed a `packages/testing`. It has one consumer in Phase 1 (`core`'s own tests), and a package with one consumer is a directory wearing a costume. Fixtures live in `packages/core/test/` until `apps/functions` genuinely needs them too.

---

## 3. The Tree

```
studio-yonetim-asistani/
│
├── apps/
│   ├── web/                        Next.js App Router → Firebase App Hosting
│   └── functions/                  Cloud Functions v2 (triggers, scheduled)
│
├── packages/
│   └── core/                       ⭐ the product. Modules. Domain. No framework.
│
├── firestore/
│   ├── firestore.rules             the ~40 lines from Doc 3 §8
│   ├── firestore.indexes.json      the table from Doc 3 §10
│   └── storage.rules
│
├── tools/
│   └── migration/                  CSV → canonical → import → reconcile (Doc 3 §12)
│
├── docs/
│   └── architecture/               01…08. This is the source of truth for *why*.
│
├── CLAUDE.md                       ⭐ what an AI agent reads first
├── firebase.json
├── pnpm-workspace.yaml
└── package.json                    scripts only. No dependencies.
```

Three packages: `apps/web`, `apps/functions`, `packages/core`. `tools/migration` is a script folder, never a published package, never deployed (AD-36).

---

## 4. `packages/core` — Module-First, Layer-Second

This is the decision that matters most, and it runs against the most common instinct.

**Rejected:** layer-first (`src/domain/`, `src/application/`, `src/infrastructure/`), where adding a feature means touching three distant directories and a reader must hold the whole system in their head to understand one behaviour.

**Chosen:** module-first. Each module is a vertical slice, layered *inside*.

```
packages/core/src/
│
├── shared/                          ⭐ the shared kernel. Everything may import this.
│   ├── ids.ts                       branded types + prefixed ULID generation (AD-16)
│   ├── money.ts                     integer kuruş. No floats, ever.
│   ├── time.ts                      Instant | LocalDate — distinct types (Doc 2 §12)
│   ├── actor.ts                     ActorRef — all nine variants (Doc 4 §5)
│   ├── event.ts                     the envelope (Doc 4 §2)
│   ├── tenant-context.ts            ⚠ never constructed by a caller
│   ├── result.ts                    Result<T, DomainError>
│   └── clock.ts                     Clock port. Injected. Never Date.now().
│
├── modules/
│   ├── identity/                    staff, roles, custom claims, impersonation
│   ├── members/                     the person. PII lives here.
│   ├── catalog/                     products
│   ├── policy/                      versioned rule sets
│   ├── entitlements/                ⭐ credits, freeze, expiry — the hard arithmetic
│   ├── scheduling/                  class sessions, templates
│   ├── reservations/                booking, cancellation, attendance
│   ├── payments/                    money in, allocations, refunds
│   ├── checkin/                     door events, occupancy
│   └── events/                      the log: append, read, upcasters
│
└── index.ts                         re-exports each module's public door. Nothing else.
```

**`projections/` does not exist in Phase 1.** Nothing reads a projection: the owner's Phase 1 view is thin and read-only, reception's day view is ~15 direct reads (within budget), and the rules engine and insight dashboard are Phase 2. Building the projection machinery — watermarks, `_projection.version`, rebuild — before there is a consumer is a future phase implemented early.

The event log is written from day one regardless. That is the investment, and it is cheap precisely because nothing depends on it yet.

**The single Phase 1 `on-event-created` trigger has exactly two dispatch entries:**

| Reacts to | Does |
|---|---|
| `member.checked_in`, `reservation.attended`, `reservation.auto_resolved`, `entitlement.*`, `payment.*` | maintains `member.stats` |
| `member.profile_updated` where `changedFields` contains `fullName` | backfills `reservation.memberSnapshot` (Doc 3 §4.4) |

Nothing else. `classSession.bookedCount` and `attendedCount` are written inside their own transactions, not here (Doc 3 §6).

### Inside one module

```
modules/entitlements/
├── README.md            ⭐ purpose · public API · invariants owned (I-1…I-8)
├── domain/              PURE. no I/O, no clock, no firebase-admin, no zod.
│   ├── entitlement.ts       the type + isBookable()
│   ├── credit-ledger.ts     hold / release / consume / restore / expire
│   ├── freeze.ts            the calendar-day arithmetic (Doc 2 §5.4)
│   ├── select.ts            earliest-expiring-first (OQ-7)
│   └── decide.ts            ⭐ (state, policy, command, now) → DomainEvent[]
├── application/         orchestration: load → decide → transact
│   ├── sell-entitlement.ts
│   ├── freeze-entitlement.ts
│   ├── adjust-credits.ts
│   └── ports.ts             interfaces this module needs from the outside
├── infrastructure/      Firestore. The ONLY place firebase-admin is imported.
│   ├── entitlement-repo.ts
│   └── entitlement-mapper.ts    Timestamp ↔ Instant. Domain never sees Timestamp.
├── events.ts            the 12 event types + payload schemas (Doc 4 §6)
└── index.ts             ⭐ THE ONLY PUBLIC DOOR
```

**Why an AI agent thrives here.** *"Add a rule: freezing is not allowed in the last 7 days of a package."* Everything is in `modules/entitlements/domain/freeze.ts` and its test file. The agent cannot accidentally reach into `reservations`, cannot import Firestore into a decision function, cannot skip the event. The structure is the guardrail.

**Each module's `README.md` states the invariants it owns.** This is the highest-leverage file in the repository for AI-assisted work — it is the context an agent needs and would otherwise reconstruct, badly, from the code.

---

## 5. Module Dependencies — a Declared, Acyclic Graph

Cross-module imports go through `index.ts`. Never `modules/x/domain/y.ts` from outside `x`.

```
                    shared  (everyone imports this; it imports nobody)
                       ▲
        ┌──────────────┼───────────────┬─────────────┐
     identity       catalog          policy        events
        ▲              ▲               ▲             ▲
        │              └───┬───────────┘             │
        │               entitlements ────────────────┤
        │                  ▲     ▲                   │
        │                  │     └── payments ───────┤
     members ──────────────┤                         │
        ▲   ▲              │                         │
        │   └───────── reservations ─────────────────┤
        │        (AD-44)    ▲                        │
        │              scheduling                    │
        │                                            │
     checkin ───────────────────────────────────────┤
                                                     │
                                    projections ─────┘
                                    (reads events; writes read models)
```

Allowed edges, exhaustively — and this list is executable (§7):

| Module | May import |
|---|---|
| `shared` | *nothing* |
| `events` | `shared` |
| `identity`, `catalog`, `policy` | `shared` |
| `members` | `shared`, `events` |
| `entitlements` | `shared`, `events`, `catalog`, `policy` |
| `scheduling` | `shared`, `events`, `identity` |
| `reservations` | `shared`, `events`, `entitlements`, `scheduling`, `policy`, **`members`** *(AD-44)* |
| `payments` | `shared`, `events`, `entitlements` |
| `checkin` | `shared`, `events`, `members` |
| `projections` *(Phase 2)* | `shared`, `events` **only** — never a domain module |

### AD-44 — why `reservations` imports `members`, and why the reverse is a trigger

A reservation document carries `memberSnapshot` (Doc 3 §4.4): four fields, so a trainer's roster costs zero member reads. Something has to read the member to build it.

**Forward: an import.** `reservations/application/book-reservation.ts` calls `members.toMemberSnapshot(member)` through the module's public door. The four-field bound therefore lives in **one exported function in `members`**, not in whichever module happens to be writing a reservation today — widening it is a diff in `members`, reviewable on sight, instead of an accident.

`reservations/domain/` stays pure and never sees a member: the snapshot arrives as an argument to the write, and it never enters an event (I-13).

**Backward: not an import.** A rename must repair every snapshot, but `members → reservations` would be the graph's only cycle. So it goes through the log, per §5's own rule — *when the graph wants a cycle, the answer is an event*:

```
member.profile_updated  { changedFields: ['fullName'] }     ← AD-25 keeps the value out
         │
         ▼
on-event-created (apps/functions — the composition root, which may import both)
         │
         ▼
reservations.backfillMemberSnapshots(memberId)
```

Erasure takes the same shape from the break-glass script (Doc 6 §10). The event that keeps PII *out* of the log is exactly the event that tells the log's consumer to repair the copy — which is a small, pleasing proof that AD-25 was the right call for a reason nobody had thought of at the time.

**When `projections` arrives in Phase 2, it reads events and nothing else.** That is what makes projections disposable (Doc 1 §10, Doc 3 §7). The moment a projector reads a state document, "delete it and rebuild from the log" becomes a lie. The dependency-cruiser rule (§7) is written now so that the constraint is enforced from the module's first commit.

**No cycles.** `reservations` depends on `entitlements`; `entitlements` never learns that reservations exist. It exposes `holdCredit()` / `releaseCredit()` and does not care who calls them. When the graph wants a cycle, the answer is an event, not an import.

---

## 6. `apps/` — Thin Adapters

Both apps are **transport adapters over the same command handlers.** Neither contains business logic. This is AD-7, made structural: Phase 2 replaces `apps/web` with Flutter and `packages/core` does not notice.

### `apps/web`

```
apps/web/src/
├── app/
│   ├── (reception)/                 the highest-volume UI. Built first.
│   ├── (owner)/
│   ├── (trainer)/                   Phase 2
│   └── api/
├── server/
│   ├── actions/                     ⭐ Server Actions. Thin.
│   │   ├── book-reservation.ts          auth → TenantContext → core handler → revalidate
│   │   └── record-payment.ts
│   ├── auth.ts                      session → claims → TenantContext
│   └── firebase-admin.ts            singleton
├── components/                      dumb. props in, JSX out.
└── lib/
    ├── firebase-client.ts           offline persistence ON (Doc 3 §5)
    └── commands.ts                  ⭐ writes /commands docs — the offline path
```

A Server Action, in full — this is the whole pattern, and it should never grow:

```ts
'use server'
export async function bookReservation(input: unknown) {
  const parsed = bookReservationSchema.parse(input)          // zod, at the boundary
  const ctx = await requireTenantContext(['owner', 'receptionist'])  // ⚠ never from input
  return core.reservations.book(ctx, parsed)                  // ← all logic lives here
}
```

Three lines. Validate, authorise, delegate. **If a Server Action grows an `if` about credits, the architecture has failed** and the reviewer — human or AI — should reject it on sight.

### `apps/functions`

```
apps/functions/src/
├── triggers/
│   ├── on-command-created.ts        ⭐ the offline path (Doc 3 §5)
│   └── on-event-created.ts          ⭐ ONE trigger → dispatch table
│                                       Phase 1: member.stats + memberSnapshot backfill.
│                                       Two entries. That is all. (§4)
├── scheduled/
│   ├── auto-resolve-attendance.ts   actor: system  (AD-38, policy.attendance.defaultOutcome)
│   └── expire-credits.ts            actor: system  (AD-26, eager nightly sweep)
└── index.ts
```

One event trigger, one dispatch table. Not one trigger per consumer — that would scatter projection logic across deploy units and make rebuilds unorderable when Phase 2 needs them.

**The two scheduled jobs are ordered, and the order is an invariant.** `auto-resolve-attendance` runs first and closes every unresolved reservation; `expire-credits` runs second and may then assume `credits.held === 0`. An entitlement that reaches `validUntil` with credits still held is a bug (I-19) — it is reported, never swept, because sweeping it would silently burn a credit that a class was about to consume.

**No `callable/` directory in Phase 1.** It would hold Flutter's transport in Phase 2, and creating a file then costs nothing. An empty directory is a promise the repository cannot keep.

**No `build-nightly-projections.ts`.** There are no projections to build (§4).

---

## 7. Enforcement — Rules That Fail the Build

Conventions a solo developer must remember are conventions an AI agent will violate. Both are fixed by the same mechanism.

**`dependency-cruiser`**, committed at the root, encoding §5 exactly:

```js
forbidden: [
  { name: 'domain-is-pure',
    from: { path: 'packages/core/src/modules/[^/]+/domain' },
    to:   { path: '(firebase-admin|firebase-functions|next|react|zod)' } },

  { name: 'no-deep-module-imports',
    from: { path: 'packages/core/src/modules/([^/]+)' },
    to:   { path: 'packages/core/src/modules/(?!$1)[^/]+/(domain|application|infrastructure)' } },

  { name: 'projections-read-events-only',
    from: { path: 'packages/core/src/modules/projections' },
    to:   { path: 'packages/core/src/modules/(?!events|shared)' } },

  { name: 'shared-imports-nothing',
    from: { path: 'packages/core/src/shared' },
    to:   { path: 'packages/core/src/modules' } },

  { name: 'no-firestore-outside-infrastructure',
    from: { pathNot: '(infrastructure|apps/functions|apps/web/src/server)' },
    to:   { path: 'firebase-admin' } },

  { name: 'no-cycles', from: {}, to: { circular: true } },
]
```

**ESLint**, for the rules dependency-cruiser cannot see:

```js
'no-restricted-globals': ['error',
  { name: 'Date', message: 'Inject Clock. See shared/clock.ts. (D2)' }],
'no-restricted-syntax': ['error',
  { selector: "NewExpression[callee.name='Date']", message: 'Inject Clock.' },
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Use ulid() from shared/ids.ts.' }],
```

Scoped to `packages/core/src/modules/*/domain/**`. A decision function that cannot read the clock cannot be non-deterministic, and a non-deterministic decision function cannot be tested exhaustively — which is the whole reason Doc 2 insisted the arithmetic be pure.

### The forbidden list, restated as build failures

| Violation | Caught by |
|---|---|
| `firebase-admin` in a decision function | dependency-cruiser |
| `Date.now()` in domain code | eslint |
| `collectionGroup()` anywhere (AD-17) | eslint `no-restricted-properties` |
| Reaching into `modules/x/domain/` from module `y` | dependency-cruiser |
| A projector reading a state document | dependency-cruiser |
| A repository accepting a raw path (Doc 3 §8) | code review + `TenantContext`-only repo constructors |
| A float used as money | branded `Money` type; the compiler |
| An event payload containing PII | golden fixture tests (Doc 4 §16) |

Six of eight are mechanical. The remaining two are exactly where the golden fixtures earn their keep.

---

## 8. Testing Layout

```
packages/core/src/modules/entitlements/domain/credit-ledger.test.ts    ← colocated, fast
packages/core/test/invariants/                                          ← property tests, I-1…I-21
packages/core/test/golden/reservation.booked.v1.json                    ← ⭐ schema contract
packages/core/test/fixtures/                                            ← builders. NOT a package.
apps/functions/test/integration/                                        ← emulator required
tools/migration/test/                                                   ← real anonymised CSVs
```

| Layer | Emulator? | Speed | What it proves |
|---|---|---|---|
| `domain/**/*.test.ts` | ❌ | ms | The credit and freeze arithmetic is correct |
| `test/invariants/` | ❌ | ms | Doc 2's twenty-one invariants hold over random command sequences |
| `test/golden/` | ❌ | ms | **Event payloads cannot drift accidentally** |
| `test/integration/` | ✅ | s | Transactions, rules, triggers |

**The pyramid is inverted on purpose.** The hard part of this system is arithmetic over entitlements, not Firestore — Firestore is boring and well-tested by Google. Ninety percent of the test value lives in the top three rows, all of which run without an emulator, in milliseconds, on every save.

---

## 9. Scripts

Root `package.json` carries scripts and no dependencies:

```jsonc
{
  "scripts": {
    "dev":             "pnpm --parallel -r dev",
    "emulators":       "firebase emulators:start --import=.seed --export-on-exit",
    "seed":            "tsx tools/seed/index.ts",

    "test":            "vitest run",
    "test:unit":       "vitest run packages/core",          // no emulator. Milliseconds.
    "test:watch":      "vitest",
    "test:integration":"firebase emulators:exec 'vitest run apps/functions'",
    "test:golden":     "vitest run packages/core/test/golden",

    "lint":            "eslint . && depcruise packages apps",
    "typecheck":       "tsc -b",
    "check":           "pnpm typecheck && pnpm lint && pnpm test:unit",   // ⭐ pre-commit

    "migrate:validate":"tsx tools/migration/validate.ts",
    "migrate:dry-run": "tsx tools/migration/run.ts --env=staging --dry",
    "migrate:reconcile":"tsx tools/migration/reconcile.ts",

    "deploy:rules":    "firebase deploy --only firestore:rules,firestore:indexes",
    "deploy:functions":"firebase deploy --only functions",
    "deploy":          "pnpm check && firebase deploy"
  }
}
```

`pnpm check` is the gate. It runs in seconds because it does not touch the emulator. **A gate that takes two minutes is a gate that gets skipped**, by a tired human and by an agent told to "just make the tests pass."

---

## 10. Conventions

| Thing | Rule |
|---|---|
| Files | `kebab-case.ts` |
| Types | `PascalCase` |
| Functions | `camelCase`; decision functions read `decideX` |
| Events | `aggregate.verb_past` (Doc 4 §3) |
| Commands | `aggregate.verb` — imperative |
| Ids | prefixed ULID; branded types (`MemberId ≠ EntitlementId`) |
| Money | `Money` branded integer kuruş |
| Dates | `Instant` for points in time, `LocalDate` for calendar days — **never interchangeable** |
| Comments | English, short, and only where the code cannot say it (a policy constraint, a Firestore quirk) |
| Turkish | UI copy and insight text only. Never identifiers. |

---

## 11. Adding a Feature — the Recipe

Written for an AI agent, deliberately. This is the paragraph most likely to be pasted into a prompt.

> Adding *"waitlist promotion"*:
>
> 1. `modules/reservations/events.ts` — add `reservation.promoted`. Bump nothing; it is new.
> 2. `test/golden/reservation.promoted.v1.json` — write the fixture **first**.
> 3. `modules/reservations/domain/decide.ts` — a pure `decidePromotion()`. No I/O.
> 4. `domain/*.test.ts` — table-driven cases, including the ones that must be refused.
> 5. `modules/reservations/application/promote-from-waitlist.ts` — load, decide, transact.
> 6. `apps/functions/triggers/on-event-created.ts` — react to `reservation.cancelled`.
> 7. `apps/web/server/actions/` — only if a human triggers it.
> 8. `pnpm check`.
>
> **Never touch `apps/web` before steps 1–5 exist.** The UI is the last thing built, because it is the only thing that can be rebuilt cheaply.

---

## 12. Deliberate Omissions

| Not doing | Why | When |
|---|---|---|
| `packages/testing` | One consumer in Phase 1. A package with one consumer is a directory wearing a costume. | When `apps/functions` integration tests genuinely need the fixtures |
| `modules/projections` | **Nothing reads a projection in Phase 1.** (§4) | Phase 2, with the rules engine that consumes it |
| `apps/functions/src/callable/` | An empty directory is a promise the repo cannot keep. | Phase 2, with Flutter |
| `policy.aiFences` | A policy is a versioned document; a field added in Phase 3 never touches history. Not a seam — scope creep. | Phase 3, free |
| Impersonation flow | One customer, whose owner is the developer. The **actor type** ships now; the flow does not. | Phase 2, first support escalation |
| `packages/contracts` split | `core/shared` already holds it. | If Flutter needs generated Dart types (Zod → JSON Schema → Dart) |
| Nx / Turborepo | Three packages. `pnpm -r` is enough. Caching a 20-second build saves nothing. | ~15 packages, or CI over 5 minutes |
| Storybook | One developer, one design system, no handoff. | A designer joins |
| A `domain-events` package separate from `core` | Same reason. | Never, probably |
| DDD `Repository` base classes / generic CRUD | Nine bespoke repositories with real method names beat one generic one with `find(criteria)`. AI agents write the former correctly and the latter catastrophically. | Never |

---

## 13. New Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| **AD-27** | pnpm workspace, **exactly three packages** | Single Next.js app / eight-package monorepo | Flutter and Functions share `core` unchanged; a solo developer is not taxed by the build graph. A fourth package must earn its way in. |
| **AD-28** | **Module-first**, layer-inside | Layer-first (`domain/`, `application/`, `infrastructure/` at the top) | A feature is one directory. An AI agent asked to change one behaviour cannot wander. |
| **AD-29** | `index.ts` is a module's only public door; deep imports fail the build | Import discipline by convention | A convention a solo developer must remember is a convention an agent will break. |
| **AD-30** | Module dependency graph is **declared and executable** (dependency-cruiser) | Documented in prose | Prose does not fail a build. |
| **AD-31** | `projections` (Phase 2) may import only `events` and `shared`; the lint rule is written now | Let projectors read state | It is the only thing that keeps "projections are disposable" honest. |
| **AD-37** | **Phase 1 ships no projections, no impersonation flow, no `aiFences`, no `callable/`, no fourth package** | Build the seams as working code | Each fails the phase-discipline test: all can be added later without touching historical data. The event log, the actor taxonomy, and the two-timestamp discipline cannot — so those ship now. |
| **AD-32** | `Date` and `Math.random` are lint errors inside `domain/` | Discipline | A pure decision function is exhaustively testable; an impure one is not. |
| **AD-33** | Golden JSON fixtures per event type, committed | Snapshot tests / trust | The only mechanical defence against silent event-schema drift, which is unrecoverable. |
| **AD-34** | Each module carries a `README.md` naming the invariants it owns | Central docs only | It is the context an AI agent needs at the moment it edits, and would otherwise infer badly. |
| **AD-35** | **Two write paths, made explicit in the code.** `server/actions/` = synchronous, trusted, scarce-resource and money operations. `lib/commands.ts` = offline-safe command writes. | One unified path | Booking allocates a seat and cannot be eventually consistent; check-in is idempotent and must survive a dead wifi. One path cannot serve both. The split is a feature, so it is named. |
| **AD-36** | `tools/migration` is a **script folder**, never a package. Never deployed, never in CI, run manually with Admin credentials for one-time imports. | A fifth package / a deployed function | A migration that can run automatically is a migration that will, once, at the wrong moment. |
| **AD-44** | `reservations` may import `members` (application layer) for `toMemberSnapshot()`. The reverse repair runs through `member.profile_updated` and the `on-event-created` trigger — **never an import.** | A port + composition-root wiring; or letting `members` import `reservations` | The four-field bound belongs in one exported function in `members`. A port would add ceremony for a solo developer; the reverse import would be the graph's only cycle. |

### AD-35 in practice

The two directories are the contract. Nothing else in `apps/web` may write.

```
apps/web/src/server/actions/     ⭐ SYNCHRONOUS · TRUSTED · REQUIRES CONNECTIVITY
  book-reservation.ts               allocates a scarce seat
  sell-entitlement.ts               creates an obligation
  record-payment.ts                 moves money
  adjust-credits.ts                 overrides the ledger
  freeze-entitlement.ts
  create-product.ts                 ⭐ E4 — owner + platform_admin only (AD-46)
  update-product.ts                    requireTenantContext(['owner','platform_admin'])
  deactivate-product.ts
  → Admin SDK. Fails loudly and visibly when offline.

apps/web/src/lib/commands.ts     ⭐ OFFLINE-SAFE · IDEMPOTENT · EVENTUALLY CONSISTENT
  recordCheckIn()                   writes /commands/{ulid}
  markAttendance()                  writes /commands/{ulid}
  → Client SDK. Queues locally. Applied by a trigger, 1–3 s later.
```

**Server Action is the default.** The command path is an *opt-in whitelist*, enforced in the security rules (Doc 3 §8): today it contains exactly `checkIn.record` and `attendance.mark`, and adding a third entry is a rules change, reviewed as such.

A write earns its place on that whitelist by answering **yes to both**:

1. **Is it idempotent?** Replaying it converges.
2. **Must it survive a dead wifi?** Reception's day genuinely stops without it.

Everything else — anything that allocates a scarce resource, moves money, or is simply not needed offline — is a Server Action. Catalogue CRUD is the clearest case of the third kind: nobody creates a product on a tablet in a basement, so it never enters the whitelist, and the question does not even arise.

A new write that seems to want a *third* path is a design smell to be raised, not resolved by the author alone.

---

## 14. Open Questions

| # | Question | Blocks |
|---|---|---|
| **OQ-4, OQ-9, OQ-11, OQ-15** | *(carried)* | — |
