# 01 — Overall System Architecture

**Status:** Draft for review
**Author:** Technical Architect (Claude) with Product Owner
**Date:** 2026-07-09
**Supersedes:** —

---

## 1. Product Thesis

> The reservation system is infrastructure. The product is judgment.

A booking engine is a **system of record**: it answers *"what is scheduled?"* This platform is a **system of judgment**: it answers *"what requires your attention, and what should you do about it?"*

The distinction is architectural, not rhetorical. A system of record optimises for writes and calendar reads. A system of judgment optimises for **capturing events with enough context to reconstruct why** — because you cannot analyse what you never recorded, and no amount of AI applied later can recover information that was never written down.

The long-term product is an **AI-powered operating system for boutique fitness businesses**. Phase 1 contains no AI. Phase 1's job is to produce the clean, attributable, event-shaped data that makes the AI possible — and to replace the studio's current operational workflow while doing it.

### The target experience

The owner opens the dashboard and — without asking — learns what needs attention: an under-filled Wednesday morning, seventeen members who have drifted, a trainer whose popularity has become a business risk, four memberships expiring today. The owner spends her time **making decisions, not searching for information**.

Note what most of that requires: not machine learning, but a **rules engine over a well-modelled event stream**. This is the backbone. AI rides on top.

---

## 2. Constraints and Forces

These outrank every architectural preference in this document. Where elegance conflicts with a constraint, the constraint wins.

| Constraint | Value | Consequence |
|---|---|---|
| **Team** | One experienced engineer, heavily AI-assisted | Optimise for *legibility to an AI coding agent*: explicit boundaries, uniform patterns, no clever indirection. Cleverness is a maintenance tax paid by one person. |
| **Phase 1 timeline** | One week to internal production | The **shape** is permanent; the **surface** is small. Pay for architecture once, up front; defer features aggressively. |
| **Backend** | Firebase (fixed) | Firestore, Auth, Cloud Functions, App Hosting. Not negotiable — design within it, not around it. |
| **Language** | TypeScript throughout | Shared domain types across Next.js and Cloud Functions. Python enters only if/when ML training arrives, and only offline. |
| **Phase 1 frontend** | Next.js (App Router) | Server-side writes via Server Actions / route handlers. |
| **Phase 2 frontend** | Flutter | ⇒ **Business logic must never live in the Next.js app.** A Flutter client must be able to do everything a Next.js client can, through the same seam. |
| **Architecture style** | Modular monolith | One deployable, hard internal module boundaries. |
| **Migration** | Real members, packages, credits, history from an incumbent platform, via CSV/Excel export | Migration is Phase 1 scope, not a footnote. |
| **Tenancy** | Multi-tenant SaaS from the first commit | Own studio is customer #1, never the only one. |

---

## 3. Architectural Drivers

Six rules. Everything else in this document — and every document after it — is a consequence of these.

### D1. Everything that happens is an event

Every state change appends an immutable event. An event has a type, **two timestamps**, a subject, and a **producer**. The producer is metadata; it is *never a branch in domain logic*.

```
{ source: "reception_tablet", actor: { type: "user", id: "u_123" } }
{ source: "home_assistant",   actor: { type: "device", id: "dev_door_main" } }
{ source: "insight_engine",   actor: { type: "ai_agent", id: "receptionist_v3" } }
```

The rule *"the branch opened 15 minutes late"* is written **once**, against `branch.opened` (Doc 4 §3 — the noun is the branch, not the studio). It never learns whether a human tapped a button or a Zigbee door sensor fired. When hardware producers arrive in a future phase, **nothing downstream changes**. This is the entire payoff of the discipline, and it is worth paying for in Phase 1 even though every producer is currently a human with a tablet.

### D2. Two timestamps, always

- `occurredAt` — when the thing happened in the world.
- `recordedAt` — when the system found out.

A sensor reports in real time; a receptionist taps "studio opened" at 09:20 for a door that opened at 09:05. **If these are the same field, the lateness metric is a lie the moment a human is in the loop.** Every event carries both. All business rules read `occurredAt`. All sync, replay, and debugging read `recordedAt`.

### D3. Policy is data, versioned — never code

Six-hour cancellation, no-freeze-on-pilates, no-show-burns-credit: these are **this studio's** rules. Studio #47 will allow four-hour cancellation and freeze everything.

The moment a policy becomes an `if` statement in a Cloud Function, the platform is dead.

Policies are **versioned documents**. Every credit-affecting decision **stamps the policy version it was evaluated under** into its event. Otherwise, the day the cancellation window changes from six hours to four, every historical dispute silently re-answers itself and the "late cancellation" analytics quietly rewrite the past. Same discipline as D2: *what the rule was then* vs. *what the rule is now*.

### D4. Every actor is a first-class principal

```
owner | receptionist | trainer | member | system | ai_agent | device | migration | platform_admin
```

**All nine ship in the type from commit #1.** Four are unused in Phase 1. The canonical union is Doc 4 §5; there is no bare `user` variant, because a principal without a role is a principal nobody can authorise.

No AI agent ever borrows a human's identity. No background job writes as "the owner." Every action is attributable, and every attribution survives in the event log. This is a Phase-1 cost for a Phase-3 capability — and retrofitting attribution onto an existing event log is impossible, because the information was never captured.

The nightly attendance sweep is the concrete case: it resolves hundreds of reservations a week as `{type: 'system', id: 'attendance_auto_resolver'}`, and it emits `reservation.auto_resolved` rather than `reservation.attended`, because **it did not watch anybody walk into a class** (AD-38).

### D5. State is fast to read; events are the substrate

**This is not pure event sourcing, and that is deliberate.**

In pure ES the log is the only truth and all state is derived by replay. Firestore is a bad host for that: no transactional multi-document replay, no cheap projection rebuild, and you would hand-roll machinery that a purpose-built event store gives away.

Instead:

- **Current state lives in documents.** A reservation is one document read. A credit balance is a number, not a fold over history.
- **Every state change also appends an event, in the same transaction as the state write.**
- **Events are the substrate** for the audit log, the rules engine, projections, the anonymised cross-tenant corpus, and eventually anything AI.
- **Projections are derived and disposable.** If the dashboard is wrong, recompute it from events.
- **Balances are corrected with compensating events, never silent overwrites.**

≈90% of the value of event sourcing at ≈30% of the cost. The one property forfeited — replay-from-zero as sole truth — will never be exercised.

### D6. Tenant isolation is enforced by rules, not by remembering to filter

Every business document lives under `/studios/{studioId}/…`. Isolation is enforced in Firestore Security Rules and in a server-side tenant guard. A query that forgets its `where("studioId", ...)` clause must be **impossible to write**, not merely discouraged.

---

## 4. System Context

```
                         ┌──────────────────────────────────┐
     Owner ─────────────▶│                                  │
     (phone/laptop)      │                                  │
                         │      Studio Yönetim Asistanı     │
     Reception ─────────▶│                                  │◀──── Platform Admin
     (tablet)            │        (modular monolith)        │      (internal)
                         │                                  │
     Trainer ───────────▶│                                  │
     (phone)             │                                  │
                         └───────┬──────────────────┬───────┘
     Member ─────────────────────┘                  │
     (web portal, Phase 1)                          │
                                                    │
                                          ┌─────────┴──────────┐
                                          │  FUTURE PRODUCERS  │
                                          │  (design for, do   │
                                          │   not build now)   │
                                          ├────────────────────┤
                                          │ Home Assistant     │
                                          │ Zigbee sensors     │
                                          │ Smart lock / HVAC  │
                                          │ WhatsApp Business  │
                                          │ AI Receptionist    │
                                          └────────────────────┘
```

**In Phase 1, every producer is a human touching a screen.** The architecture is indifferent to that fact, which is the point.

---

## 5. Container View

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                            │
│  Next.js App Router (Phase 1)  ·  Flutter (Phase 2)                 │
│  Reception UI │ Owner UI │ Trainer UI │ Member portal               │
└────────────────────────────┬────────────────────────────────────────┘
                             │  ① commands (Server Actions / callable)
                             │  ② direct reads (Firestore SDK, rule-guarded)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  APPLICATION — modular monolith (TypeScript)                        │
│                                                                     │
│   ┌───────────┬───────────┬───────────┬───────────┬─────────────┐   │
│   │ identity  │ members   │ catalog   │ policy    │ entitlements│   │
│   ├───────────┼───────────┼───────────┼───────────┼─────────────┤   │
│   │ payments  │ scheduling│ reservatns│ checkin   │ events      │   │
│   └───────────┴───────────┴───────────┴───────────┴─────────────┘   │
│                                                                     │
│   shared kernel: event envelope · actor · tenant ctx · clock · ids  │
│                                                                     │
│   Phase 2: projections · insights   ·   tools/migration is NOT a    │
│   module — it is a manually-run script folder (AD-36)               │
└────────┬───────────────────────────────────┬────────────────────────┘
         │ write path                        │ async
         ▼                                   ▼
┌──────────────────────┐        ┌──────────────────────────────────┐
│  FIRESTORE           │        │  CLOUD FUNCTIONS (2nd gen)       │
│  ─ state documents   │◀───────│  · Firestore triggers            │
│  ─ events (append)   │───────▶│  · Cloud Scheduler (nightly)     │
│  ─ projections       │        │  · callable commands             │
│  ─ policies          │        └──────────────────────────────────┘
└──────────────────────┘
         │
         │  FUTURE (not Phase 1)
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Pub/Sub ──▶ BigQuery   telemetry, ML training, cross-tenant     │
│  Cloud Storage          raw archives, migration dumps            │
└──────────────────────────────────────────────────────────────────┘
```

### Why Cloud Functions *and* Next.js server code

They are not redundant; they serve different masters.

- **Next.js server-side (Server Actions / route handlers)** hosts **synchronous commands** — the user is waiting. Book a class. Check a member in. Record a payment.
- **Cloud Functions** host **asynchronous work** — nobody is waiting. Firestore triggers that update projections. The nightly scheduled rules engine. Later: webhooks from WhatsApp and Home Assistant, which cannot call a Next.js Server Action.

Both import the **same domain modules**. A command is a plain TypeScript function; the transport is incidental. This is what makes the Flutter migration a change of client, not a rewrite of the system.

---

## 6. The Write Path

Every mutation, without exception, follows this path.

```
Client
  │
  ▼
Command (typed input, Zod-validated at the boundary)
  │
  ▼
Tenant guard        — resolve studioId + branchId from auth claims, never from client input
  │
  ▼
Authorization       — actor may perform this command on this subject
  │
  ▼
Load aggregate      — current-state documents
  │
  ▼
Load policy         — the versioned policy in force at occurredAt
  │
  ▼
Decide              — pure function: (state, policy, command) → { newState, events[] }
  │                    ── no I/O, no clock, no randomness ──
  ▼
Firestore transaction
  ├── write new state
  └── append event(s)          ← same transaction, always
  │
  ▼
Firestore trigger (async)
  └── update projections, feed the rules engine
```

Two properties are load-bearing:

**The decision is a pure function.** `(state, policy, command) → events`. No I/O. No `Date.now()` — time is injected. This is the only part of the system with genuinely hard logic (credit consumption, cancellation windows, freeze arithmetic), and it is the part that must be exhaustively unit-testable without a Firestore emulator.

**State and event commit atomically.** If they can drift, the event log is decorative and every downstream conclusion is suspect. Firestore transactions give us this within a tenant, which is all we need.

---

## 7. The Read Path

### Role-scoped projections

Firestore Security Rules grant or deny a **document**. They cannot hide a **field**.

The trainer may see her own occupancy but must never see *"Reyhan is at 94%, everyone else averages 61%"* — that is dynamite in a five-person team. Reception sees daily operational numbers but not margins.

Therefore **there is no single `dashboard/today` document.** Projections are sharded by audience:

```
/studios/{sid}/branches/{bid}/projections/owner/…
/studios/{sid}/branches/{bid}/projections/reception/…
/studios/{sid}/branches/{bid}/projections/trainer/{trainerId}/…
```

Each is written **only** by a trusted server-side projector. Each is readable by exactly one role. This is a schema consequence of a permissions decision, and it is cheap now and a rewrite later.

### Two kinds of read

1. **Live operational reads** — today's classes, who is booked, a member's credit balance. Direct Firestore reads from the client, guarded by rules. Real-time listeners where the UI benefits (the check-in screen).
2. **Computed reads** — occupancy rates, revenue vs. target, at-risk members, insights. Never computed in the client, never computed on request. **Precomputed into projection documents** by triggers (incremental) or the nightly batch (analytical). The dashboard is a document read, not a query fan-out.

The owner's morning dashboard must be **one document read**. Not fifteen aggregation queries. This is both a latency decision and, at a thousand studios, a cost decision.

---

## 8. Multi-Tenancy and Isolation

### Hierarchy

> ⚠️ **Superseded by Doc 3 §3.1 (AD-13).** The nested shape below was overturned during the Firestore design: the tenant boundary is the studio, so `branchId` is an **indexed field**, not a path segment. Nesting bought no isolation and forced collection-group queries for the owner's cross-branch dashboard. The sketch is kept for the record; read Doc 3 §3 for the real tree.

```
/studios/{studioId}                     ← the tenant. The billing boundary.
    /branches/{branchId}                ← ⚠ config only. Not a parent of data.
    /members/{memberId}                 ← studio-scoped: a member belongs to the
    /entitlements/{entitlementId}         studio and may attend any of its branches
    /classSessions, /reservations, /payments, /checkIns   ← branchId is a FIELD
    /policies/{policyId}
    /staff/{userId}
    /events/{eventId}                   ← one append-only log per tenant
```

Every customer studio today has exactly one branch. **The dimension exists anyway.** Adding a second branch means writing documents with a different `branchId` — not restructuring anything.

The placement of `members` at the studio level, not the branch level, is a deliberate domain claim: *branches share members and packages; separate studios never do.* If that is wrong for a future customer, it is a hard change — flagged as **Open Question OQ-2**.

### Three layers of isolation

1. **Path** — data is physically nested under its tenant. Cross-tenant reads are not a filter you can forget; they are a path you cannot construct.
2. **Custom claims** — `{ studioId, branchIds[], role }` are minted into the Firebase Auth token at user creation and re-minted on role change. Rules read the token, never client-supplied parameters.
3. **Server-side tenant context** — every command handler receives a `TenantContext` it did not construct. Repositories take that context and build paths from it. **A repository that accepts a raw path is a bug.**

### Platform Admin and impersonation

Platform Admin is a **separate principal with a separate claim**, not "an owner with extra permissions."

**The actor type ships in Phase 1. The impersonation *flow* does not.** `{type: 'platform_admin', impersonating?: StaffUserId}` exists in the actor union from commit #1, because an actor taxonomy cannot be retrofitted onto events already written. The feature itself — time-boxed sessions, `platform.impersonation_started` / `.ended` events, owner-visible disclosure — is **Phase 2**.

The reason is the phase-discipline test (Doc 6, Prime Directives): *can this be added later without touching historical data?* For the flow, yes. For the actor type, no. So the seam is built and the feature is not. There is exactly one customer in Phase 1, and its owner is the developer.

When it does ship, impersonation is time-boxed, emits events into the **target studio's** log, and is visible to that studio's owner. Every SaaS forgets to build this until the first support escalation makes it impossible to avoid.

---

## 9. Time, Idempotency, and Offline

### Offline policy — deliberate and narrow

Firestore offline persistence is **on**. But offline is not uniformly safe, and pretending otherwise is how a pilates studio ends up needing distributed consensus.

| Operation | Offline? | Why |
|---|---|---|
| Read today's classes, roster, member profile | ✅ Yes | Stale reads are harmless. |
| Check in a member who already has a reservation | ✅ Yes | **Idempotent.** Replaying it converges. |
| Mark attendance for a class | ✅ Yes | **Idempotent.** The trainer's phone in a basement studio. |
| Book the last spot in a full class | ❌ No | **Allocates a scarce resource.** Two partitioned tablets would both succeed and Firestore would accept both on reconnect. |
| Record a payment | ❌ No | **Moves money.** Never guess. |
| Sell a package, issue a refund, override a credit | ❌ No | Money or entitlement. |
| Create or edit a product | ❌ No | Trusted data. Nobody builds a price list on a tablet in a basement. |

The two ✅ writes are exactly the `/commands` whitelist (Doc 3 §5), and it is enforced in security rules rather than by client discipline. **Server Action is the default**; a write joins the whitelist only if it is idempotent *and* reception's day genuinely stops without it (Doc 5 §13, AD-35).

Reception's tablet keeps working through a wifi blip for the operations that dominate its day, and refuses — visibly, with an honest message — the operations that cannot be made safe. Simplicity over completeness, as directed.

### Idempotency

Every command carries a **client-generated `commandId`** (UUID). The transaction checks for an existing event with that `commandId` before writing. A retried check-in, a double-tapped button, a replayed offline queue: all converge. This is four lines of code and the difference between a trustworthy event log and a fictional one.

### Clock

Time is injected, never read from ambient global state, in all domain logic. `occurredAt` may be supplied by the client (the receptionist says the studio opened at 09:05); `recordedAt` is always server-assigned (`FieldValue.serverTimestamp()`). **A client-supplied `occurredAt` is untrusted input** and is clamped to a sane window relative to server time.

---

## 10. Projections and Rebuild

A projection is a **cache with a lineage**. Every projection document carries:

```ts
{
  _projection: {
    version: 7,                  // bump ⇒ rebuild
    builtAt: Timestamp,
    throughEventId: "evt_...",   // watermark
  }
}
```

Two builders:

- **Incremental** — Firestore triggers. Occupancy counters, member `lastAttendanceAt`, live headcount. Cheap, near-real-time, and *eventually consistent by design*.
- **Analytical** — nightly Cloud Scheduler batch. Occupancy rates by slot, trainer comparison, at-risk members, revenue vs. target, and (Phase 2+) the Turkish-language insight documents.

**A projection is never repaired by hand.** If it is wrong, bump `version` and rebuild from events. This is only possible because of D5, and it is the property that makes the nightly rules engine safe to iterate on: get a rule wrong, fix it, rebuild, no data loss.

Per-document write contention: Firestore sustains roughly one write per second to a single document. A class occupancy counter — a class holds ~8–15 people — is nowhere near that ceiling. **Distributed counters are unnecessary and would be premature.** Revisit only if a studio-wide counter document appears.

---

## 11. The AI Seam

AI is **absent from Phase 1 behaviour and present in Phase 1 shape.**

| Level | Capability | What it needs | Phase |
|---|---|---|---|
| **L0** | Rules engine. Queries, aggregates, thresholds. *"17 members haven't attended in 14 days."* | Events + projections | **2** |
| **L1** | Read-only insight. Summarise, rank, explain — in Turkish. Humans act. | L0 + LLM batch job | 2–3 |
| **L2** | Drafts, human approves. AI writes the message to the churning member. | L1 + messaging channel | 3 |
| **L3** | Acts within a fence. AI Receptionist books and cancels inside declared limits. | L2 + `ai_agent` principal + policy fences + audit | 4 |
| **L4** | Autonomous front desk. | — | Not a near-term goal |

### The uncomfortable truth about the dashboard

Most of the target experience is **not AI**:

- *"17 members have not attended for over 14 days"* → a query.
- *"Wednesday 11:00 averages 28% occupancy"* → an aggregate.
- *"Four memberships expire today"* → a query.
- *"Reception has not checked in 3 arriving members"* → a scheduled rule reasoning about **an event that did not happen** — the most interesting computation on the list, and still not AI.

Genuine intelligence begins at *"five of these seventeen will not renew"* (prediction, requiring labelled churn outcomes that do not yet exist), *"today is a good day to call these four"* (**prioritisation under a budget** — she will make four calls, not seventeen), and *"consider shifting a Reyhan session"* (recommendation with a trade-off).

**The rules engine is the backbone.** It is correct on day one with zero training data. A churn model trained on 200 members is a coin flip wearing a lab coat. Build the backbone; let AI ride on it.

### What Phase 1 owes the future

Nothing is built. Three things are guaranteed:

1. `ai_agent` exists in the actor taxonomy and in the authorization layer. When an agent first acts, it acts as *itself*, with its own permissions, in the audit log.
2. Insights are **documents**, not API responses. The nightly batch writes `projections/owner/insights/{date}`; the dashboard reads it instantly. The same document shape serves a future conversational assistant, which will read events and write the same insight type.
3. Policy fences are already policy documents. When L3 arrives, *"never message after 21:00"* and *"never issue a refund"* are policy entries, not new code.

---

## 12. The Physical World (Future Phases)

Home Assistant, Zigbee sensors, smart locks, HVAC, occupancy counters, energy monitoring — **first-class event producers, arriving later, plugging into the model that already exists.**

The integration path, decided now so the domain need not change later:

```
Home Assistant  ──webhook──▶  Cloud Function (ingest)
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
        Domain-significant events        High-frequency telemetry
        branch.opened                    temperature every 30s
        member.entered                   power draw
        door.forced                      motion pings
                    │                             │
                    ▼                             ▼
            Firestore /events           Pub/Sub ──▶ BigQuery
            (the domain cares)          (aggregates only)
```

**The split is essential.** Firestore charges per document write, forever, for data that is only ever read as an aggregate. A thermostat reporting every thirty seconds is ~2,900 writes per device per day — a rounding error in the domain, a permanent line item on the bill. Telemetry goes to a time-series store; **only the derived, domain-significant state enters Firestore** (`hvac.runtime_exceeded`, not 2,880 temperature readings).

This is why *"the air conditioning has been running for 5 hours"* is a **rule over telemetry that emits a domain event**, not a domain event per se. The distinction is not pedantry; it is the difference between a $20/month studio and a $200/month studio.

---

## 13. Cross-Tenant Learning

Two learning levels, as specified:

- **Level 1 — within a studio.** Best class hours, attendance patterns, renewal behaviour, local seasonality, trainer performance. Reads that studio's own events. No privacy question arises.
- **Level 2 — across the platform.** Industry benchmarks, seasonal trends, churn models, revenue forecasting. **Aggregated and anonymised only. Individual customer data is never exposed to another customer.**

### The design consequence, paid for now

**Identity and behaviour are separated at the schema level.**

Events reference a member by **opaque id only**. Names, phone numbers, and e-mail addresses live in `/studios/{sid}/members/{memberId}` — never inside an event payload. An event says *"member `m_a91f` consumed a credit at 19:04 in a class of eight"*; it never says *"Ayşe Yılmaz."*

Therefore the anonymised cross-tenant corpus is a **projection** — a de-identified export, with `memberId` re-hashed per-tenant per-export — rather than a scrubbing script written in a panic three years from now. Retrofitting "we'd like to train on your data" onto existing customers is a conversation nobody wins.

**Legal (OQ-4):** KVKK/GDPR posture, the data-processing agreement, and whether aggregated cross-tenant learning requires explicit customer consent are matters for counsel before customer #2 signs, not for this document to assert. The architecture keeps the door open; the lawyer decides whether to walk through it.

---

## 14. Non-Functional Targets

| Concern | Target | Mechanism |
|---|---|---|
| Owner dashboard load | < 500 ms | One projection document read |
| Check-in write | < 300 ms perceived | Optimistic UI + idempotent command |
| Availability | Firebase SLA; studio hours are 07:00–22:00 TRT | No custom HA. A studio is not a bank. |
| Cost per studio | Bounded by projections, not queries | Precompute; never fan-out on read |
| Region | Firestore `eur3` (Europe multi-region); Functions co-located `europe-west1` | Latency from Türkiye; EU residency posture. Confirm under **OQ-4**. |
| Audit retention | Events are immutable and never deleted | Append-only rules; deletion is a compensating event |

---

## 15. Environments

| Env | Firebase project | Purpose |
|---|---|---|
| `local` | Emulator suite | Unit + integration tests. The domain layer needs no emulator at all. |
| `staging` | `studio-asistani-staging` | Migration dry-runs. **Every migration is rehearsed here against real exported data before it touches production.** |
| `prod` | `studio-asistani-prod` | The studio. Real members. Real money. |

---

## 16. Migration Architecture

> ⚠️ **Superseded in part by AD-36 (Doc 5 §13).** An earlier draft of this section called migration *"a module, not a script."* **That was overturned.** `tools/migration` is a **script folder** — never a package, never deployed, never in CI, run by hand with Admin credentials. *A migration that can run automatically is a migration that will, once, at the wrong moment.*
>
> What survives is the **shape** below: adapter → canonical DTO → validator → importer → reconciler. Customer #2 arrives with a different incumbent, and only the adapter changes. That was the real point, and it costs nothing to keep as a script.

```
CSV/Excel export ──▶ [Adapter: incumbent-specific]
                          │  parse, coerce, map ids
                          ▼
                     Canonical import DTOs
                          │
                          ▼
                     [Validator]  ── fail loudly, never guess
                          │
                          ▼
                     [Importer]   ── emits real domain events
                          │            actor: { type: "migration" }
                          ▼
                     Firestore (state + events)
                          │
                          ▼
                     [Reconciler] ── assert every active package's
                                     remaining credits match the source
```

Four commitments:

1. **The importer emits events**, with `actor: { type: "migration" }` and `occurredAt` set to the *historical* time. The event log therefore contains the studio's real history, not a cliff at go-live. This is the single most valuable asset for future ML and it is nearly free to capture correctly today.
2. **Raw exports are archived to Cloud Storage, unparsed, immediately.** Before anything is modelled. Historical attendance becomes unrecoverable the day the incumbent's subscription lapses — pull *everything* now, model it later.
3. **Remaining credits are reconciled member-by-member and signed off by a human.** A member with three sessions left will absolutely notice if she has eight. This is the one number that cannot be reconstructed, faked, or apologised for.
4. **Freeze-and-cut, not parallel writes.**

### On running both systems in parallel

**Recommendation: do not.** The proposed step *"run both systems in parallel for a few days"* is the classic path to two divergent sources of truth and a very bad Wednesday. If reception can check a member in on either system, credit balances will diverge, and there is no principled reconciliation — only a guess about which system was right.

Instead:

| Step | Action |
|---|---|
| 1 | Old system goes **read-only** at a declared instant (Sunday night). Nobody writes to it again. |
| 2 | Export at that instant. Archive raw to Cloud Storage. |
| 3 | Import to **staging**. Reconcile. Fix adapters. Repeat until clean. |
| 4 | Import to **production**. Human signs off on credit balances. |
| 5 | Monday: new system is the **only writer**. |
| 6 | Old system remains **readable** for several weeks as a dispute reference, then is archived and cancelled. |

You keep the safety net and lose the failure mode. *Product owner: please confirm or override — this changes the cutover plan in Document 8.*

---

## 17. Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| **AD-1** | State documents + append-only event log, committed in one transaction | Pure event sourcing | Firestore has no replay machinery. 90% of the value, 30% of the cost, maintainable by one engineer. |
| **AD-2** | Modular monolith, one deployable | Microservices | One engineer. Module boundaries are enforced by lint rules, not network calls. |
| **AD-3** | Tenant-scoped paths (`/studios/{sid}/…`) from commit #1 | Top-level collections + `studioId` filter | A forgotten filter is a data breach. A path cannot be forgotten. |
| ~~**AD-4**~~ | ~~`branches` level exists though every studio has one~~ | — | ⚠️ **Superseded by AD-13 (Doc 3 §3.1).** The tenant boundary is the studio; `branchId` is an indexed **field**, not a path segment. Nesting bought no isolation and forced collection-group queries. |
| **AD-5** | Policy as versioned documents; version stamped into every decision event | Policy as code | Per-tenant rules; historical decisions must stay explicable after a rule changes. |
| **AD-6** | Role-scoped projection documents | One dashboard document + field-level filtering | Firestore rules cannot hide fields. |
| **AD-7** | Domain logic in framework-free TypeScript modules | Logic in Server Actions / React | Phase 2 is Flutter. Logic in the Next.js layer would have to be rewritten. |
| **AD-8** | Offline reads + idempotent check-in only; scarce-resource and money writes require connectivity | Full offline write support | Avoids distributed consensus in a pilates studio. |
| **AD-9** | Telemetry → Pub/Sub → BigQuery; only derived events → Firestore | All sensor data in Firestore | Per-write pricing on data only read as aggregates. |
| **AD-10** | PII never enters event payloads; events reference opaque ids | Denormalise names into events for convenience | Level-2 cross-tenant learning must be a projection, not a future scrubbing script. |
| **AD-11** | Migration importer emits historical events | Bulk-load current state only | The imported history is the future ML training set. |
| **AD-12** | Freeze-and-cut migration | Parallel writable systems | Two writable systems produce two truths and unresolvable credit disputes. |

**Later decisions that amend this document:** AD-13 supersedes AD-4 (§8, §17). AD-36 supersedes "migration is a module" (§16). AD-42 fixes the event envelope (Doc 4 §2). The full register lives in [`README.md`](./README.md).

---

## 18. Open Questions

| # | Question | Blocks | Owner |
|---|---|---|---|
| ~~OQ-1~~ | ~~Confirm freeze-and-cut over parallel operation (§16).~~ | — | **Closed.** Confirmed. AD-12 stands; Doc 8 §7 is the cutover. |
| **OQ-2** | Are members studio-scoped or branch-scoped? Committed to **studio-scoped**. A future franchise customer whose branches must not share members would force a migration. | Doc 3 (Firestore) | Product Owner — *watch* |
| ~~OQ-3~~ | ~~Export contents: historical attendance, remaining credits, phones, product variants.~~ | — | **Closed.** E1–E4 answered. Grade **A**. Doc 8 §5. |
| **OQ-4** | KVKK/GDPR: data residency, DPA terms, consent basis for Level-2 learning. | Customer #2, not Phase 1 | Counsel |
| **OQ-5** | Member authentication method — phone/OTP is the Turkish expectation, and Firebase Auth phone verification carries per-SMS cost. Confirm before the member portal. | Phase 2 | Product Owner |
| ~~OQ-6~~ | ~~Private/PT: modelled but not built.~~ | — | **Closed.** PT is in the imported catalogue and **sells in Phase 1**. AD-45. |
| ~~OQ-18~~ | ~~Who may write `/products`?~~ | — | **Closed.** `owner` + `platform_admin`; enforced in the Server Action, not a rule. AD-46, Doc 3 §8. |

---

## 19. What Phase 1 Is

Stated plainly, so Document 8 has something to be measured against:

**Phase 1 is reception's day.** Members, the product catalogue, credits, class schedule, booking, check-in, payment recording, migration. The owner gets a thin read-only view and the catalogue screen. Trainer and member portals wait.

The event log is written from day one and **nothing reads it except the audit trail.** That is the investment, and it is cheap precisely because nothing yet depends on it.

The rules engine and the insight dashboard are Phase 2 — by which time they will sit on a month of real events instead of an empty database.
