# Architecture

The source of truth for **why** this system is shaped the way it is.

When you wonder *"why is it like this?"*, the answer is here, numbered `AD-nn`, with the alternative that was rejected. **If you cannot find it, ask — do not re-derive it differently.**

---

## The documents

| # | Document | Read it when |
|---|---|---|
| **01** | [System Architecture](./01-system-architecture.md) | You need the drivers, containers, write/read paths, multi-tenancy, AI seams, migration strategy |
| **02** | [Domain Model](./02-domain-model.md) | **Before touching any business logic.** Credit ledger, freeze arithmetic, state machines, **21 invariants** |
| **03** | [Firestore Data Model](./03-firestore-data-model.md) | Collections, document shapes, indexes, security rules, the `/commands` collection |
| **04** | [Event Model](./04-event-model.md) | **Before adding or changing any event.** Envelope, actor taxonomy, event catalogue, versioning, de-identification |
| **05** | [Folder Structure](./05-folder-structure.md) | Module boundaries, dependency graph, build-failing rules, the feature recipe |
| **06** | [Development Principles](./06-development-principles.md) | Prime directives, testing, errors, cost budgets, git, working with AI agents |
| **07** | [CLAUDE.md](../../CLAUDE.md) | Start here. It distils 01–06 into one screen. |
| **08** | [Phase 1 Roadmap](./08-phase-1-roadmap.md) | The seven days, the export gate, the cutover, what is explicitly out |
| — | [DEBT.md](../DEBT.md) | Deliberate debt, each with a trigger to repay |

**Reading order for a new session:** `CLAUDE.md` → the module's own `README.md` → the doc that owns the thing you are changing.

---

## The six ideas everything else follows from

1. **The reservation system is infrastructure. The product is judgment.** Optimise for capturing events with enough context to reconstruct *why*.
2. **The producer never appears in the event type.** A door sensor emits `branch.opened`, not `device.door_opened`. This is what lets hardware replace a receptionist in 2027 without changing one rule.
3. **Policy is versioned data.** Nothing in the code knows the number six, and nothing knows that this studio presumes attendance.
4. **PII never enters an event payload.** This is what makes erasure a one-document delete instead of a rewritten log.
5. **Clients read state and write commands. Clients never write state.**
6. **A presumption is never written down as an observation.** The `system` actor emits `reservation.auto_resolved`, never `reservation.attended`. An event log that contains things nobody saw cannot answer *"what happened?"*

---

## Decisions

Superseded decisions are struck through and point at what replaced them.

### Doc 01 — System Architecture

| # | Decision |
|---|---|
| AD-1 | State documents + append-only event log, committed in one transaction. **Not** pure event sourcing. |
| AD-2 | Modular monolith, one deployable. Boundaries enforced by lint, not network calls. |
| AD-3 | Tenant-scoped paths (`/studios/{sid}/…`) from commit #1. A forgotten filter is a data breach; a path cannot be forgotten. |
| ~~AD-4~~ | ~~`branches` is a path level~~ → **superseded by AD-13** |
| AD-5 | Policy as versioned documents; the version is stamped into every decision event. |
| AD-6 | Role-scoped projection documents. Firestore rules grant documents and cannot hide fields. |
| AD-7 | Domain logic in framework-free TypeScript. Phase 2 is Flutter. |
| AD-8 | Offline reads + idempotent check-in only. Scarce-resource and money writes require connectivity. |
| AD-9 | Telemetry → Pub/Sub → BigQuery. Only derived events → Firestore. |
| AD-10 | PII never in event payloads; events reference opaque ids. |
| AD-11 | The migration importer emits **historical** events. |
| AD-12 | Freeze-and-cut migration. **No parallel writable systems.** |
| ~~§16~~ | ~~"Migration is a module, not a script"~~ → **superseded by AD-36** |

### Doc 02 — Domain

| # | Decision |
|---|---|
| **AD-38** | **A presumption is not an observation.** `policy.attendance.defaultOutcome` resolves an unmarked reservation; the `system` actor emits `reservation.auto_resolved`, never `reservation.attended`. Every outcome carries `source`. *(E2)* |
| **AD-39** | `entitlement.adjusted` carries a **closed-enum `reason`** (`gift \| correction \| migration \| support`) **and** a mandatory non-empty `note`. *(E1)* |
| **AD-41** | **The catalogue is data.** Products are created, edited, deactivated, imported. No name, price, or credit count in a source file. `category` stays a **closed enum** — the category wall depends on it. *(E4)* |

### Doc 03 — Firestore

| # | Decision |
|---|---|
| **AD-13** | **Branches are an indexed field, not a path segment.** The tenant is the studio. *(supersedes AD-4)* |
| AD-14 | `credits.available` is stored, written only inside transactions. *(DEBT-004)* |
| **AD-15** | **Clients read state; clients write commands.** One `allow create` in the entire rule set. |
| AD-16 | Prefixed ULIDs; client-generated for commands (offline-mintable idempotency keys). |
| AD-17 | No collection-group queries in Phase 1. |
| **AD-40** | **Phones are E.164, always.** The migration normalises; invalid or colliding numbers **block the run**. Never guessed, never merged. *(E3)* |
| **AD-46** | **Catalogue write authz (`owner` + `platform_admin`) lives in the Server Action, not a Firestore rule.** The rule stays `allow write: if false`; reception reads and sells. *(OQ-18)* |

### Doc 04 — Events

| # | Decision |
|---|---|
| **AD-18** | `<aggregate>.<verb_past>`. **The producer never appears in the event type.** |
| AD-19 | Semi-fat payloads: the delta, plus the post-state of every number changed. |
| AD-20 | Rejected commands are **not** events. |
| AD-21 | Upcasting on read. Stored events are never rewritten. |
| AD-22 | `reason` is mandatory on adjustment, correction, cancellation, refund — enforced in the **domain**. |
| AD-23 | ULID order = arrival order. Business chronology = `occurredAt`. Conflating them is the subtlest bug here. |
| AD-24 | `insight.acted_on` / `.dismissed` declared now — the AI's future training labels. |
| AD-25 | `member.profile_updated` carries changed **field names**, never values. |
| AD-26 | Credit expiry is an **eager nightly sweep**. A signal that only exists when observed is not a signal. |
| **AD-42** | **The canonical envelope is Doc 4 §2**: `correlationId` required, `causationId` nullable. Doc 3 §4.5 mirrors it. |
| **AD-43** | **One expiry event: `entitlement.expired`.** `entitlement.credits_expired` is removed. |

### Doc 05 — Structure

| # | Decision |
|---|---|
| AD-27 | pnpm workspace, **exactly three packages**. A fourth must earn its way in. |
| AD-28 | **Module-first**, layer-inside. A feature is one directory. |
| AD-29 | `index.ts` is a module's only public door. Deep imports fail the build. |
| AD-30 | The module dependency graph is **declared and executable** (dependency-cruiser). |
| AD-31 | `projections` (Phase 2) may import only `events` and `shared`. |
| AD-32 | `Date` and `Math.random` are lint errors inside `domain/`. |
| AD-33 | Golden JSON fixtures per event type. The only mechanical defence against silent schema drift. |
| AD-34 | Each module's `README.md` names the invariants it owns. |
| AD-35 | **Two write paths, explicit in the code.** `server/actions/` is the **default**; `lib/commands.ts` is an opt-in, rules-enforced whitelist. |
| AD-36 | `tools/migration` is a script folder. Never deployed, never in CI. *(supersedes Doc 1 §16)* |
| AD-37 | Phase 1 ships no projections, no impersonation flow, no `aiFences`, no `callable/`, no fourth package. |
| **AD-44** | `reservations` imports `members` for `toMemberSnapshot()`. The reverse repair is a **trigger on `member.profile_updated`**, never an import. |

### Doc 08 — Roadmap

| # | Decision |
|---|---|
| **AD-45** | **Phase 1 ships catalogue CRUD and sells PT.** *(supersedes OQ-6; cut-ladder item #1)* |

---

## The export gate — closed

| # | Question | Answer |
|---|---|---|
| **E1** | Remaining credits | **Explicit.** Booking holds (available drops at once); in-window cancel releases; admin adjusts with `reason` + `note`. *(AD-39)* |
| **E2** | Attendance | **Uncancelled ⇒ presumed attended.** Manual marking is an override. Modelled as policy + `source`. *(AD-38)* |
| **E3** | Phones | **Normalise to E.164.** Invalid or colliding rows block the import. *(AD-40)* |
| **E4** | Catalogue | **Data, imported from source.** Nothing hardcoded. *(AD-41, AD-45)* |

**Grade A.** Cutover stays on Day 7. See Doc 8 §5.

---

## Open questions

**None are blocking.** Every question that gated a Phase 1 decision is closed. What remains is a watch item and four questions that belong to later phases — each with a home and a trigger, none in the critical path to scaffolding.

| # | Question | Owner | Due |
|---|---|---|---|
| OQ-2 | Members are studio-scoped (branches share them). A franchise whose branches must *not* share members would force a migration. | Product Owner | **Watch** — not a Phase 1 decision |
| OQ-5 | Member auth: phone/OTP is the Turkish expectation; Firebase phone verification costs per SMS. | Product Owner | Before the member portal (Phase 2) |
| OQ-9 | Auto-check-out threshold. Suggest 4h. | Product Owner | Phase 2 (occupancy display) |
| OQ-11 | Unallocated payments do not auto-allocate. Reception allocates explicitly. | Reception UI | Phase 2 |
| OQ-15 | Client-side search threshold: 2,000 members, or the first customer who asks. | — | *(DEBT-001)* |
| OQ-4 | KVKK/GDPR: legal basis for cross-tenant learning. | Counsel | **Before customer #2** |

**Closed:** ~~OQ-1~~ (freeze-and-cut confirmed) · ~~OQ-3~~ (E1–E4, Grade A) · ~~OQ-6~~ (PT sells, AD-45) · ~~OQ-18~~ (catalogue authz, AD-46) · ~~OQ-7, OQ-8, OQ-10, OQ-12, OQ-13, OQ-14, OQ-16, OQ-17~~

---

## Status

> ## Architecture v1.0 Final — ready for implementation
>
> `01`–`08` approved, binding, and **mutually consistent**. The export gate is closed at Grade A.
> **Forty-six decisions. Twenty-one invariants. Zero blocking questions.** Code not yet scaffolded.

Amendments require an `AD-nn` with the alternative that was rejected. **Prose does not fail a build; decisions do.**
