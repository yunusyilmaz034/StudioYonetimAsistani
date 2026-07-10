# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Repository status: Architecture v1.0 Final — ready for implementation. Code not yet scaffolded.**
> `docs/architecture/01…08` are **approved, binding, and mutually consistent**. Start at [`docs/architecture/README.md`](docs/architecture/README.md).
> The export gate is closed at Grade A (E1–E4). Forty-six decisions, twenty-one invariants, zero blocking questions.
> The commands and paths below describe the system as designed. Until scaffolding lands, treat this file as the specification you are implementing against, not a description of files that exist.

---

## What this is

A multi-tenant SaaS platform for boutique fitness studios. The first customer is a women-only Pilates & Fitness studio in Türkiye; it is **not** the only customer, and no code may assume it is.

**The reservation system is infrastructure, not the product.** The product is a decision-support system: the owner opens a dashboard and immediately knows what needs attention today. Everything in this repository exists to make that possible — which is why the event log matters more than the booking screen.

**Phase 1 ships zero AI.** Its job is to run reception's day and to accumulate clean, attributable, event-shaped data. The rules engine and insights are Phase 2. Do not build them early.

---

## Communication

- **Talk to the user in Turkish.** Explanations, questions, proposals, summaries.
- **Everything in the repository is English**: code, identifiers, file names, commit messages, comments, architecture docs.
- Technical terms (Event, Aggregate, Projection, Domain Model, Firestore) stay English in Turkish prose.
- Turkish appears in exactly two places in the codebase: **user-facing UI copy** and **`DomainError` messages**. Never in identifiers.

---

## Think like an architect, not an implementer

Before doing anything, run every non-trivial change through this gate — and **say the answer out loud**:

0. Does it solve a real **operational** problem? *(If not — challenge it. Do not build it.)*
1. Does it serve the product vision? *(Does it change a decision the owner makes?)*
2. Is it sustainable in five years?
3. Is it more complex than Phase 1 requires? *(Is it a seam, or a future phase built early?)*
4. Can one developer maintain it?
5. Is it good for AI-assisted development? *(Can an agent do the wrong thing here without a build failure?)*

**If any answer is no: stop, warn the user, propose the better alternative.** If a decision creates long-term technical debt, say so before writing the code. The user wants an architect who objects, not an assistant who complies.

### Priority order, when principles collide

```
Correctness > Simplicity > Maintainability > Extensibility > Performance
```

Never trade correctness for performance. Prefer simple over clever. **No premature optimisation** — optimise after measuring. A denormalised field justified by *correctness* is architecture; one justified by *unmeasured speed* is debt in costume.

### Phase discipline

> Never implement a future phase early. **Design the extension point and stop.**

The test: **can this be added later without touching historical data?**

- Actor taxonomy — **no**, it cannot be retrofitted onto events already written → build the seam now.
- AI behaviour, waitlist logic, `policy.aiFences` — **yes**, always addable → build nothing.

---

## The twelve non-negotiables

Violating one is a defect, not a style disagreement.

1. **Every state change appends an event, in the same transaction as the state write.** If they can drift, the log is decorative.
2. **The producer never appears in the event type.** A door sensor emits `branch.opened`, not `device.door_opened`.
3. **Two timestamps.** `occurredAt` is domain time (may be client-supplied, always clamped). `recordedAt` is `serverTimestamp()`. Never the same field.
4. **Policy is versioned data, never an `if`.** Every credit-affecting decision stamps the policy version it was judged under. *Nothing in the code knows the number six.*
5. **Every actor is a principal.** No AI agent, background job, or migration script borrows a human's identity.
6. **PII never enters an event payload.** Identity lives in `/members`; behaviour lives in events. This is what makes GDPR/KVKK erasure possible at all.
7. **Decision functions are pure.** `(state, policy, command, now) → events`. No I/O, no `Date.now()`, no `Math.random()`.
8. **Clients read state and write commands. Clients never write state.**
9. **Corrections are compensating events**, never silent overwrites. `reason` is mandatory, enforced in the domain.
10. **Money is an integer in kuruş.** A float in a money path is a bug.
11. **A presumption is never written down as an observation.** The `system` actor emits `reservation.auto_resolved`, never `reservation.attended`. *(AD-38)*
12. **The catalogue is data.** No product name, price, or credit count appears in a source file. *(AD-41)*

Four of these are **unbreakable** because breaking them is unrecoverable rather than merely costly: an event is never mutated or deleted (1, 9); PII never enters an event (6); state and its event commit together (1); a presumption never masquerades as an observation (11).

Everything else may be broken **if the reason is written down** in `docs/DEBT.md` or as a new `AD-nn`.

---

## Architecture in one screen

```
Client (Next.js · Flutter later)
  │
  ├─ reads state directly (Firestore SDK, security-rule guarded)
  │
  ├─ server/actions/     SYNCHRONOUS · TRUSTED · needs network
  │                      booking, payments, selling, credit adjustment
  │                      → anything that allocates a scarce resource or moves money
  │
  └─ lib/commands.ts     OFFLINE-SAFE · IDEMPOTENT · eventually consistent (1–3 s)
                         check-in, attendance marking
                         → writes /commands/{ulid}; a trigger applies it
  │
  ▼
packages/core  ── the SAME pure domain functions on both paths
  │              validate → authorize → load → load policy → decide (pure) → transact
  ▼
Firestore transaction: state document(s) + event(s), atomically
  │
  ▼
onEventCreated trigger → (Phase 1: member.stats only)
```

**Test for which write path:** **Server Action is the default.** A write joins the `/commands` whitelist only if it is **idempotent** *and* reception's day genuinely stops without it offline. Today that whitelist is exactly `checkIn.record` and `attendance.mark`, and it is enforced in security rules — adding a third entry is a rules change. Anything that allocates a scarce resource or moves money can never join it.

### Firestore shape

Everything is **studio-scoped and flat**. `branchId` is an indexed **field**, never a path segment.

```
/studios/{studioId}/
    branches · staff · policies · products
    members          ← the ONLY place PII lives
    entitlements     ← the credit ledger
    classSessions · reservations · payments · checkIns
    events           ← append-only. ULID ids. Never mutated, never deleted.
    commands         ← the ONLY client-writable collection
```

---

## Domain essentials

Read `docs/architecture/02-domain-model.md` before touching business logic. The parts most often gotten wrong:

**Check-in ≠ attendance.** `member.checked_in` = walked through the door (→ occupancy). `reservation.attended` = **observed** present in class (→ credit consumption). Conflating them poisons both metrics permanently.

**Attendance ≠ its policy default.** A reservation nobody cancelled is *presumed* attended in this studio. A presumption is not an observation:

| Event | Emitted by | `source` |
|---|---|---|
| `reservation.attended` / `.no_show` | trainer, reception | `trainer` |
| `reservation.auto_resolved` | **`system` only** | `system_default` |
| `reservation.corrected` | owner, reception | `correction` |

The `system` actor **never** emits `reservation.attended`. Let it, and the no-show rate is a structural zero, the churn signal never exists, and none of it can be recovered — `attendanceSource` cannot be backfilled. The default itself is `policy.attendance.defaultOutcome`, not an `if`. *(AD-38)*

**Booking *holds* a credit; it does not consume one.** The member's `available` drops by one immediately — `held` is subtracted — but the credit stays reversible until the reservation resolves. Otherwise a member with one credit books five classes.

```
granted → held (booking) → consumed (attended | presumed | no-show | late cancel)
                        → released (cancelled inside the window — no counter moves)
        → restored (admin gift, attendance correction)     ← never `granted`
        → revoked  (admin take-back)                       ← never `consumed`
        → expired  (at validUntil, unused)                 ← the churn signal

available = granted + restored − consumed − held − revoked − expired
```

**Admin credit adjustment** needs a closed-enum `reason` (`gift | correction | migration | support`) **and** a non-empty `note`. A decrease that would go below zero is **refused, never clamped**. *(AD-39)*

**The catalogue is data.** Products are created, edited, deactivated, and imported from the source. Never a literal in code. `category` stays a closed enum — the category wall depends on it. *(AD-41)* Writing it is **`owner` + `platform_admin` only**, enforced in the Server Action — reception reads and sells but does not edit the price list. *(AD-46, OQ-18)*

**Phones are E.164.** Normalisation is total or the row is rejected. Collisions are reported, never merged. *(AD-40)*

**Payment ⟂ Entitlement.** Many-to-many, with amounts. `priceAgreed` is what was *owed*; `Payment.amount` is *revenue* (cash basis, on `receivedAt`). Selling without payment is legal — `balanceDue > 0` — and the owner dashboard must surface it.

**Which entitlement pays?** Earliest-expiring-first. Deterministic tie-break: `validUntil` → `purchasedAt` → `id`.

**The category wall.** An unlimited fitness membership does not open the reformer room, and a PT package does not open a group class. `entitlement.productSnapshot.category === session.category`, enforced in the domain, not the UI.

**Twenty-one invariants** live in Doc 2 §15. They *are* the domain test suite.

---

## Commands

```bash
pnpm check              # ⭐ THE GATE: typecheck + lint + dependency-cruiser + unit tests. Seconds.
pnpm test:unit          # packages/core. No emulator. Milliseconds.
pnpm test:golden        # event payload schema contracts
pnpm test:integration   # firebase emulators:exec — transactions, rules, triggers
pnpm test -- credit-ledger        # a single file
pnpm lint               # eslint + depcruise
pnpm typecheck

pnpm dev                # web + functions
pnpm emulators          # firebase emulators, seeded

pnpm migrate:validate   # tools/migration — never runs in CI, never deploys
pnpm migrate:dry-run    # against staging, always, before production
pnpm migrate:reconcile  # assert every entitlement's remaining credits vs. source

pnpm deploy:rules       # firestore rules + indexes
pnpm deploy             # runs `check` first
```

`pnpm check` runs pre-commit and takes seconds by design. **A gate that takes two minutes is a gate that gets skipped.**

---

## Where things live

```
packages/core/src/
  shared/                 ids · money · time · actor · event envelope · TenantContext · Clock
  modules/<name>/
    README.md             ⭐ purpose · public API · THE INVARIANTS THIS MODULE OWNS — read this first
    domain/               PURE. no I/O, no firebase-admin, no clock, no zod.
    application/          load → decide → transact
    infrastructure/       the ONLY place firebase-admin is imported
    events.ts             event types + payload schemas
    index.ts              ⭐ the module's only public door

apps/web/src/server/actions/    synchronous trusted writes — THE DEFAULT
apps/web/src/lib/commands.ts    offline-safe command writes — an opt-in whitelist
apps/functions/src/triggers/    on-command-created · on-event-created (two dispatch entries)
apps/functions/src/scheduled/   auto-resolve-attendance → expire-credits
                                (both actor: system; that order is invariant I-19)
tools/migration/                script folder. Manual. Admin credentials. Never deployed.
firestore/                      rules + indexes
docs/architecture/              ⭐ 01…08 — the source of truth for WHY
```

Modules: `identity · members · catalog · policy · entitlements · scheduling · reservations · payments · checkin · events`

`projections` is **Phase 2**. Nothing reads a projection yet.

---

## Rules that fail the build

`dependency-cruiser` and `eslint` enforce these. Do not work around them — if one is wrong, change the rule deliberately and say why.

| Forbidden | Why |
|---|---|
| `firebase-admin` inside `modules/*/domain/` | Decision functions are pure |
| `Date.now()` / `new Date()` / `Math.random()` in `domain/` | A non-deterministic decision function cannot be exhaustively tested |
| `collectionGroup()` anywhere | How a tenant-scoped schema grows a cross-tenant read path |
| Deep imports across modules (`modules/x/domain/y`) | Modules have one public door: `index.ts` |
| A repository taking a raw path or query | Repositories build paths from `TenantContext` |
| Root-level `collection('members')` | Always `/studios/{sid}/…` via `TenantContext` |
| A Server Action containing an `if` about credits | Logic belongs in `core` |
| A projector reading a state document | Kills "projections are disposable" |
| Floats for money | Branded `Money` = integer kuruş |
| PII in an event payload | Caught by golden fixture tests |
| The `system` actor emitting `reservation.attended` | AD-38. It emits `reservation.auto_resolved`. |
| A product name, price, or credit count in a source file | AD-41. The catalogue is data. |
| A phone stored in Turkish local format | AD-40. E.164, or reject the row. |
| An admin credit decrease landing in `consumed` | It lands in `revoked`. `consumed` means *a class took it*. |
| Editing production data by hand / via the Firebase console | Use a break-glass script that emits events with a `reason` |

---

## Adding a feature

Never touch `apps/web` before steps 1–5 exist. The UI is the last thing built, because it is the only thing that is cheap to rebuild.

1. `modules/<m>/events.ts` — declare the event.
2. `test/golden/<event>.v1.json` — write the fixture **first**.
3. `modules/<m>/domain/decide.ts` — the pure decision function.
4. `domain/*.test.ts` — table-driven cases, **including the ones that must be refused**, including boundaries (`exactly 6h` is not `5h 59m`).
5. `modules/<m>/application/<use-case>.ts` — load, decide, transact.
6. `apps/functions/triggers/` — only if something reacts.
7. `apps/web/server/actions/` or `lib/commands.ts` — pick by the write-path test.
8. `pnpm check`.

### Before you finish

- [ ] Solves a real operational problem, and belongs to **this** phase
- [ ] `pnpm check` passes
- [ ] Domain logic pure; boundary cases tested
- [ ] New events have golden fixtures; **changed events have a version bump AND an upcaster**
- [ ] New denormalised fields are in the register (Doc 3 §6) with a rebuild path
- [ ] Security rules updated **and tested** if a collection changed
- [ ] The screen's read budget is respected (owner dashboard = **1 read**)
- [ ] Turkish copy exists for every new `DomainError`
- [ ] Debt, if taken, is in `docs/DEBT.md` **with a trigger to repay** (a condition, never a date)

---

## What the human owns

Delegate implementation freely. **Do not decide these alone:**

- What an invariant is
- Which cases must be **refused**
- **Event schema changes** — permanent and unrecoverable
- Anything touching migration or money
- The five-question gate

Event schemas and credit arithmetic are the two places to slow down. Everything else can be rewritten.

---

## Reference

| Doc | Contains |
|---|---|
| `docs/architecture/01-system-architecture.md` | Drivers, containers, write/read paths, multi-tenancy, AI seams, migration |
| `02-domain-model.md` | Aggregates, credit ledger, freeze arithmetic, state machines, **21 invariants** |
| `03-firestore-data-model.md` | Collections, document shapes, indexes, security rules, the commands collection |
| `04-event-model.md` | Envelope, actor taxonomy, **event catalogue**, versioning, de-identification |
| `05-folder-structure.md` | Module boundaries, dependency graph, enforcement, the feature recipe |
| `06-development-principles.md` | Prime directives, testing, errors, cost, git, debt register |
| `08-phase-1-roadmap.md` | The seven days, the cutover, what is explicitly out |
| `docs/DEBT.md` | Deliberate debt, each with a trigger to repay |

Decisions are numbered `AD-nn` and carry the alternative that was rejected. **When you wonder "why is it like this?", the answer is in `docs/architecture/`.** If you cannot find it, ask — do not re-derive it differently.
