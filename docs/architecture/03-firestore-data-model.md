# 03 — Firestore Data Model

**Status:** Draft for review
**Depends on:** [01 — System Architecture](./01-system-architecture.md), [02 — Domain Model](./02-domain-model.md)
**Date:** 2026-07-09
**Amends:** Doc 1 §8 (collection hierarchy) — see §3.1

---

## 1. Purpose and Method

Document 2 described the business. This document maps it onto Firestore.

The mapping is not mechanical. Firestore has opinions — no joins, no server-side aggregation worth relying on, per-document write ceilings, rules that grant documents rather than fields, and a pricing model that charges for every read. A model that ignores those opinions produces a correct system with a ruinous bill and a slow dashboard.

**Where the mapping is ugly, we change the mapping — never the domain.** Two places below, the ugliness was severe enough that it revealed a mistake in Document 1. Those are marked.

---

## 2. Firestore Constraints That Shape Everything

| Constraint | Value | Consequence for us |
|---|---|---|
| Document size | 1 MiB | Event payloads stay small. No embedded histories. |
| Sustained writes per document | ~1/sec | Fine for `classSession.bookedCount` (8–15 people). Watched, not engineered around. |
| Transaction | reads before writes; ≤500 writes | Booking touches 4 docs. Comfortable. |
| Security rules | grant **documents**, cannot hide **fields** | ⇒ role-scoped projections (D-6) |
| Rules are **not filters** | a `list` query must be *provably* within the rule | ⇒ clients must include the constraining `where` clause themselves |
| No joins | — | ⇒ deliberate, listed denormalisation (§6) |
| Reads are billed per document | — | ⇒ dashboards are **one document read**, never a fan-out |
| Offline persistence | client SDK only | ⇒ offline writes cannot go through a server. **See §5 — this is the hard one.** |

---

## 3. Collection Tree

```
/studios/{studioId}                                   ← the tenant. The security boundary.
│
├── /branches/{branchId}                              config only: name, timezone, hours
├── /staff/{userId}                                   owner | receptionist | trainer
├── /policies/{policyId}                              versioned; a new version is a new document
├── /products/{productId}                             catalogue
│
├── /members/{memberId}                               ⚠ PII lives here and nowhere else
├── /entitlements/{entitlementId}                     ⚠ NOT a subcollection of member — see §3.2
├── /classSessions/{classSessionId}
├── /reservations/{reservationId}
├── /payments/{paymentId}
├── /checkIns/{checkInId}
│
├── /events/{eventId}                                 append-only. ULID keys. The substrate.
│
├── /commands/{commandId}                             ⚠ the ONLY client-writable collection — §5
│
└── /projections/{projectionId}                       role-scoped read models — §7
```

Everything is **studio-scoped and flat**. No collection is nested more than one level below the tenant.

### 3.1 Correction to Document 1: branches are a dimension, not a level

Document 1 §8 proposed `/studios/{sid}/branches/{bid}/classSessions/…`. **That was wrong, and I am overturning it before it costs anything.**

The reasoning that changed my mind:

- **The tenant boundary is the studio, not the branch.** Isolation, billing, and security all cut at the studio. A branch is an *attribute of a class*, in the same way a trainer is. We do not nest classes under trainers.
- **The owner's dashboard reads across branches.** *"Occupancy is 94% at Kadıköy and 61% at Moda."* With nested collections that is a collection-group query, and collection-group queries interact badly with security rules and force an awkward index on every branch-scoped collection.
- **Nesting bought us nothing.** It did not enforce isolation (the studio path already does), and it added a path segment to every read, every rule, and every repository call.

So: `classSession.branchId` is a **field**, indexed. Branch-scoped access control becomes a field comparison against the `branchIds` claim (§8). This is strictly simpler, and it satisfies the original requirement — *multiple branches without a future migration* — because adding a second branch means writing documents with a different `branchId`, not restructuring anything.

**Doc 1 §8 should be read as superseded by this section.** The `branches` collection still exists; it holds branch *configuration*. It does not hold branch *data*.

### 3.2 Entitlements are not a subcollection of Member

The obvious instinct is `/members/{mid}/entitlements/{eid}`. It is wrong here, and the reason is a query on the owner's dashboard:

> *"Eight packages will expire with unused sessions."*

That is a studio-wide question: *every entitlement, any member, expiring in the next N days, with `credits.available > 0`.* As a subcollection it is a collection-group query. As a top-level studio collection it is an ordinary indexed query, and the security rule is one line.

**Phase 1 rule: no collection-group queries.** Not one. They are the mechanism by which a tenant-scoped Firestore schema quietly develops a cross-tenant read path, and avoiding them entirely is cheaper than auditing them.

The reverse query — *"this member's entitlements"* — is `where('memberId','==',mid)`, which is what reception's screen needs anyway.

---

## 4. Document Shapes

TypeScript, with Firestore's types where they differ from the domain's. The domain layer never sees `Timestamp`; a mapper converts at the repository boundary (Doc 5).

### 4.1 `members/{memberId}`

```ts
{
  id: 'mem_01J7Z…',                    // prefixed ULID — see §9
  studioId: 'std_…',
  homeBranchId: 'brn_…' | null,

  // ── PII. This document is the only place it exists. (I-13, AD-10) ──
  fullName: string,
  phone: string,                        // ⚠ ALWAYS E.164: '+905321234567'. Validated. (I-21, AD-40)
  phoneNormalized: string,              // digits only, no '+' — reception searches by this
  email: string | null,
  birthDate: string | null,             // 'YYYY-MM-DD' — a LocalDate, never a Timestamp
  notes: string | null,
  emergencyContact: { name: string, phone: string } | null,

  status: 'active' | 'inactive' | 'deleted',
  joinedAt: Timestamp,

  // ── denormalised. Rebuildable from events. Never authoritative. ──
  stats: {
    lastAttendanceAt: Timestamp | null,
    lastCheckInAt: Timestamp | null,
    totalAttended: number,
    activeEntitlementCount: number,
    balanceDue: number,                 // kuruş, across all entitlements
  },

  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

`phoneNormalized` exists because Firestore has no `LIKE`. Reception types `532 123` and expects a match. Prefix search on a normalised field (`>=` / `<= `) is the only thing Firestore does natively. Anything richer — name search with Turkish collation, `İ`/`ı` folding — needs an external index, and **that is a Phase 2 problem, not a Phase 1 one.** Flagged: for 300 members, reception's client can filter a cached list locally, and that is a perfectly good answer for a year.

### 4.1.1 Phone numbers are E.164, always (E3, AD-40)

The incumbent stores Turkish local formats, inconsistently — `05321234567`, `5321234567`, and worse. **The system stores exactly one shape.** This is not a display preference: the phone is the de-facto member identity in Türkiye, the key reception searches by, and the join key a future WhatsApp integration will need.

```
input               →  normalise                        →  stored
05321234567            strip non-digits, drop 0 prefix     +905321234567
5321234567             strip non-digits                    +905321234567
+90 532 123 45 67      strip separators                    +905321234567
0212 555 12 12         landline, not a mobile              ⚠ validation report
532 12 34              too short                           ⚠ validation report
```

Two rules, enforced at the validation boundary (Doc 6 §8) and again by the migration validator (§12):

1. **Normalisation is total, or it fails loudly.** A number that cannot be coerced to a valid Turkish mobile E.164 is never guessed at, never truncated, never stored. It lands in the validation report for a human to resolve.
2. **No two active members of a studio share a phone number.** A collision is a data-quality fact — a mother booking for her daughter, a duplicate record, a typo — and only a human can say which. It is **reported, never merged automatically.**

Both are invariant **I-21**. `phoneNormalized` is the same digits without the `+`, for prefix search.

### 4.2 `entitlements/{entitlementId}`

```ts
{
  id: 'ent_01J7Z…',
  studioId: 'std_…',
  memberId: 'mem_…',                    // indexed
  productId: 'prd_…',

  productSnapshot: {                    // frozen at purchase. Never re-read from /products.
    name: '8 Ders Pilates Paketi',
    category: 'pilates_group',
    grant: { kind: 'credits', credits: 8, validForDays: 30 },
    price: 420000,                      // kuruş — the LIST price
  },
  policyRef: { policyId: 'pol_…', version: 3 },    // ⚠ D3

  status: 'active' | 'frozen' | 'expired' | 'exhausted' | 'cancelled',
  validFrom: Timestamp,
  validUntil: Timestamp,                // indexed. Freeze moves this.

  credits: {                            // null ⇔ period entitlement
    granted: 8, held: 1, consumed: 3, restored: 0, revoked: 0, expired: 0,
    available: 4,                       // ⚠ DERIVED, stored. Written only inside transactions.
                                        //   = granted + restored − consumed − held − revoked − expired
  } | null,

  freeze: {                             // null ⇔ freezing not permitted (pilates)
    entitledDays: 7, usedDays: 0,
    periods: [{ from: '2026-08-01', to: '2026-08-05' }],   // LocalDate strings
    activeFrom: null,
  } | null,

  priceAgreed: 420000,                  // what was owed. ≠ productSnapshot.price ⇒ discount
  paidTotal: 420000,
  balanceDue: 0,                        // indexed — the owner's 'tahsil edilmemiş' query

  purchasedAt: Timestamp,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**`credits.available` is stored, not computed on read.** It is denormalised arithmetic over the other six counters. Storing it is what lets `where('credits.available','>',0)` exist as an index, which is what makes *"packages expiring with unused sessions"* a query rather than a full scan. It is written **only** inside the booking/cancellation/adjustment transaction, alongside the counters it derives from, so it cannot drift.

`revoked` is separate from `consumed` on purpose (Doc 2 §5.3): an admin taking a credit back must never inflate *"credits actually spent in classes"*, which is the denominator of every utilisation number the owner will look at.

This is a deliberate violation of "never store derived data." The alternative is scanning every entitlement nightly. Recorded as **AD-14**.

### 4.3 `classSessions/{classSessionId}`

```ts
{
  id: 'cls_01J7Z…',
  studioId: 'std_…',
  branchId: 'brn_…',                    // indexed — a field, not a path (§3.1)
  trainerId: 'usr_…',                   // indexed
  templateId: 'tpl_…' | null,

  category: 'pilates_group' | 'fitness' | 'private',
  startsAt: Timestamp,                  // indexed
  endsAt: Timestamp,
  capacity: 8,

  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled',
  cancellation: { reason: string, by: ActorRef, at: Timestamp } | null,

  bookedCount: 6,                       // ⚠ authoritative. Transaction-guarded.
  attendedCount: 5,                     // projected

  // denormalised for the roster screen — avoids N reads to render a class
  trainerName: 'Reyhan',
  branchName: 'Moda',

  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

### 4.4 `reservations/{reservationId}`

```ts
{
  id: 'res_01J7Z…',
  studioId: 'std_…',
  branchId: 'brn_…',
  classSessionId: 'cls_…',              // indexed
  memberId: 'mem_…',                    // indexed
  entitlementId: 'ent_…',               // which package paid (OQ-7)

  status: 'booked' | 'cancelled' | 'late_cancelled' | 'attended' | 'no_show' | 'waitlisted',
  creditEffect: 'held' | 'consumed' | 'released' | 'none',

  // ── denormalised from the session. The reason is below. ──
  sessionStartsAt: Timestamp,           // indexed
  sessionEndsAt: Timestamp,
  sessionCategory: 'pilates_group',

  // ── minimal member snapshot for the trainer's roster (OQ-12, bounded) ──
  memberSnapshot: {
    memberId: 'mem_…',
    displayName: 'Ayşe Y.',             // given name + surname initial. Not full legal name.
    phoneLast4: '4567',                 // disambiguates two members named Ayşe Y.
    membershipStatus: 'active',         // trainer sees expiry risk without a second read
  },

  bookedAt: Timestamp,
  bookedBy: ActorRef,
  resolvedAt: Timestamp | null,
  resolvedBy: ActorRef | null,
  attendanceSource: 'trainer' | 'system_default' | 'correction' | null,   // ⚠ I-18, AD-38
  policyRef: { policyId: 'pol_…', version: 3 },
}
```

`attendanceSource` is `null` while the reservation is unresolved. It is what separates *"a trainer watched her walk in"* from *"nobody said anything and the policy presumed she came"* — permanently, and unrecoverably if omitted. See Doc 2 §8.

**`memberSnapshot` is a bounded exception, and the bounds are the point.** Four fields, no more: enough to render a roster and tell two members apart, not enough to reconstruct a person. Full name, phone, e-mail, birth date, and notes stay in `/members` exclusively.

Three rules hold it in place:
1. **It never enters an event payload.** I-13 is untouched.
2. **The de-identified corpus is projected from events, not reservations**, so this copy cannot contaminate cross-tenant learning.
3. **It is purged on erasure.** A KVKK/GDPR deletion request must clear `memberSnapshot.displayName` and `phoneLast4` across the member's reservations — the only place outside `/members` where a name exists. This is the sole reason erasure is not a single-document delete. (See Doc 4 §14.)

`sessionStartsAt` is denormalised for two queries that would otherwise be impossible:

- **The attendance auto-resolver:** `where('status','==','booked').where('sessionEndsAt','<', now)`. Without the copy, this requires reading every session first.
- **A member's upcoming classes:** `where('memberId','==',m).where('sessionStartsAt','>=', now)`.

A session's `startsAt` effectively never changes. **If a class is rescheduled, we do not update reservations — we cancel and rebook**, which is what the members experience anyway and what the event log should record. *(DEBT-005.)*

### Who builds `memberSnapshot`, and who repairs it (AD-44)

The four fields are constructed by **one exported function, `toMemberSnapshot()`, owned by the `members` module.** The bound lives in exactly one place, so widening it is a diff in `members`, not an accident in whoever is writing a booking today.

```
book-reservation (reservations/application)
  └─ members.toMemberSnapshot(member)   ← the four-field bound, enforced once
       └─ written onto the reservation document.  NEVER onto an event. (I-13)
```

The reverse direction — a member renames, and her reservations must be backfilled — **is not an import.** `members` never depends on `reservations`; that would be the graph's only cycle (Doc 5 §5). Instead the rename emits `member.profile_updated` with `changedFields: ['fullName']` (AD-25), and the `on-event-created` trigger calls the backfill. The event that keeps PII *out* of the log is exactly the event that tells the log's consumer to repair the copy.

Erasure runs the same way, from the break-glass script (Doc 6 §10): purge `displayName` and `phoneLast4`, keep the row.

### 4.5 `events/{eventId}` — the substrate

> **The canonical envelope is Doc 4 §2 (AD-42).** This is its Firestore projection, field for field. If the two ever disagree again, Doc 4 wins and this section is the bug.

```ts
{
  id: 'evt_01J7ZQK…',                   // ULID ⇒ lexicographically time-sorted
  studioId: 'std_…',
  branchId: 'brn_…' | null,             // null for studio-wide events

  type: 'reservation.booked',           // see Doc 4 §6 for the catalogue
  version: 1,                           // payload schema version

  occurredAt: Timestamp,                // ⚠ D2 — when it happened in the world
  recordedAt: Timestamp,                // ⚠ D2 — serverTimestamp(); when we found out

  actor: { type: 'receptionist', id: 'usr_…' },
  source: 'reception_tablet',           // metadata. NEVER branched on. (D1)

  subject: { kind: 'reservation', id: 'res_…' },
  related: {                            // opaque ids only. NO PII. (I-13)
    memberId: 'mem_…',
    entitlementId: 'ent_…',
    classSessionId: 'cls_…',
  },
  payload: { creditEffect: 'held', creditsAvailableAfter: 4 },
  policyRef: { policyId: 'pol_…', version: 3 } | null,   // ⚠ I-12

  // ── causation. All three. See Doc 4 §2 and §9. ──
  commandId: 'cmd_…' | null,            // the intent that caused this. Idempotency key.
  causationId: 'evt_…' | null,          // the event that caused this event
  correlationId: 'cor_01J7Z…',          // ⚠ REQUIRED. One workflow, many events.
}
```

**`correlationId` is required on every event, on both write paths.** A booking writes `reservation.booked` and `entitlement.credit_held`; a cancellation may write three. Without the correlation, an audit eight months from now is a list of rows instead of a story, and it cannot be added retroactively.

`commandId` is present only on the `/commands` path. **It is therefore not a substitute for `correlationId`** — a Server Action has no command document, and that gap is why the envelope carries both.

`causationId` is `null` throughout Phase 1: events are caused by commands, not by other events. It is in the envelope now because Phase 2's projectors and Phase 4's agents will emit event-caused events, and a nullable field added later leaves every historical event permanently blank.

**One event collection per studio, not per branch.** Rebuilding a projection, feeding the rules engine, and exporting the anonymised corpus are all studio-wide operations. A branch is a field. (This is the same correction as §3.1.)

**ULID document ids** give lexicographic time ordering for free, which means *"events since watermark X"* is `orderBy('__name__').startAfter(X)` — no index, no `recordedAt` range query with ties. Events are never updated and never deleted; rules enforce it (§8).

---

## 5. The Offline Problem, and the Commands Collection

This is the most important section in the document, and it resolves a contradiction that Documents 1 and 2 left standing.

**The contradiction.** Doc 1 (AD-8) promises reception can check members in while the wifi is down. Firestore's offline persistence only works for **client SDK writes** — a Server Action requires a network round-trip. But if the client writes domain state directly, then credit arithmetic, invariant checks, and event appending happen in **untrusted code**, and security rules would have to validate the entire domain model. That way lies madness: rules are not a place to implement a credit ledger.

**The resolution: clients never write state. Clients write *commands*.**

```
        ONLINE                                OFFLINE-CAPABLE
  ┌──────────────────┐                    ┌──────────────────────┐
  │  Server Action   │                    │  Client SDK write to │
  │  (Admin SDK)     │                    │  /commands/{cmdId}   │
  └────────┬─────────┘                    └──────────┬───────────┘
           │                                         │ queued locally
           │                                         │ syncs on reconnect
           ▼                                         ▼
   ┌────────────────────────────────────────────────────────┐
   │  DOMAIN LAYER — the same pure functions, either way    │
   │  invariants · policy · event generation                │
   └────────────────────────┬───────────────────────────────┘
                            │
                            ▼
              Firestore transaction: state + event
```

A `/commands/{commandId}` document is an **intent**, not a fact. It says *"reception asked to check in member X at 09:04."* A Firestore `onDocumentCreated` trigger picks it up, runs the same domain code the Server Action would have run, and writes state plus events transactionally.

```ts
// /studios/{studioId}/commands/{commandId}
{
  id: 'cmd_01J7Z…',                     // ⚠ client-generated ULID = the idempotency key
  studioId: 'std_…',
  type: 'checkIn.record',               // strictly whitelisted — see rules
  actor: { type: 'receptionist', id: 'usr_…' },   // must equal request.auth.uid
  occurredAt: Timestamp,                // client-supplied. Clamped server-side.
  recordedAt: Timestamp,                // serverTimestamp()
  payload: { memberId: 'mem_…', branchId: 'brn_…', direction: 'in' },

  status: 'pending' | 'applied' | 'rejected',
  result: { eventIds: string[] } | { error: string } | null,
  processedAt: Timestamp | null,
  expiresAt: Timestamp,                 // Firestore TTL — applied commands vanish after 30d
}
```

### Which commands may be offline

Exactly the ones AD-8 permits. The whitelist is enforced in security rules, so it is not a matter of client discipline:

| Command | Offline | Why |
|---|---|---|
| `checkIn.record` | ✅ | Idempotent. Allocates nothing. |
| `attendance.mark` | ✅ | Idempotent. The trainer's phone in a basement studio. |
| `reservation.book` | ❌ | Allocates a **scarce seat** and holds a credit. |
| `payment.record` | ❌ | Moves money. |
| `entitlement.sell` / `.freeze` / `.adjust` | ❌ | Money or entitlement. |

Everything on the ❌ list goes through a Server Action and fails loudly, and visibly, when offline. Reception sees *"Bağlantı yok — rezervasyon alınamıyor"* rather than a cheerful lie.

### Why this is the right shape

1. **The domain layer is written once** and runs in both paths. A Server Action and a trigger call the identical function.
2. **`commandId` is the idempotency key** and it is the document id. A retried offline write, a double-tapped button, a replayed sync queue — all collapse to one document. Invariant I-2 survives contact with reality.
3. **Security rules become tiny.** Clients get `read` on their tenant's data and `create` on `/commands` with a whitelisted `type` and an `actor.id` equal to their own uid. **No other client write exists anywhere in the system.** That is a security rule set a single developer can actually audit.
4. **The Flutter client (Phase 2) inherits it for free.** It writes the same command documents.
5. **The AI agent (Phase 3) inherits it too** — it writes a command with `actor: {type:'ai_agent'}`, subject to the same whitelist and the same policy fences.

**The cost, stated honestly:** check-in becomes eventually consistent. The tablet writes a command; the trigger applies it a second or two later. The UI shows the pending command optimistically (it is in the local cache), so the receptionist sees the member as checked in immediately. If the trigger later rejects the command — the member was already inside — the UI reconciles. This is correct behaviour and it is *more* honest than a synchronous write that lies about durability.

**AD-15.** Clients read state and write commands. Clients never write state.

---

## 6. Denormalisation Register

Every copy of data is a liability. Each one is listed here, with its owner and its rebuild path. **An undocumented denormalisation is a bug.**

| Field | Lives on | Source of truth | Updated by | Rebuildable? |
|---|---|---|---|---|
| `member.stats.*` | member | events | `on-event-created` trigger | ✅ from events |
| `entitlement.credits.available` | entitlement | the six counters beside it | booking / cancellation / adjustment transaction | ✅ arithmetic |
| `entitlement.paidTotal` / `balanceDue` | entitlement | `payments.allocations` | payment transaction | ✅ from payments |
| `classSession.bookedCount` | classSession | reservations | booking transaction | ✅ count query |
| `classSession.attendedCount` | classSession | reservations | **attendance transaction** (not a trigger — see below) | ✅ count query |
| `classSession.trainerName` / `branchName` | classSession | staff / branches | write-time copy | ✅ backfill on rename |
| `reservation.sessionStartsAt` / `EndsAt` / `Category` | reservation | classSession | write-time copy | ✅ (sessions do not move — §4.4) |
| `reservation.memberSnapshot` | reservation | member | write-time copy via `members.toMemberSnapshot()` | ✅ backfill on `member.profile_updated`; **purge on erasure** |
| `member.phoneNormalized` | member | `member.phone` | write-time | ✅ |

`attendedCount` is written **in the same transaction as the attendance outcome**, exactly like `bookedCount`, not by the `on-event-created` trigger. Both the manual-marking path and the auto-resolve sweep already hold that transaction open; deferring the counter to a trigger would buy nothing and would let a roster screen show 6 attended out of 5 booked for a second and a half.

**`bookedCount` and `credits.available` are the two that must never drift**, because bookings depend on them transactionally. Both are written inside the transaction that changes their inputs. A nightly consistency check recomputes both and reports (never silently repairs — a drift is a bug, and a self-healing system hides its bugs).

---

## 7. Projections

Role-scoped, because rules grant documents and cannot hide fields (D-6). The trainer must never receive a document containing *"Reyhan 94%, others 61%."*

```
/studios/{sid}/projections/{projectionId}

  owner_daily__{branchId}__2026-07-09        → the morning dashboard. ONE read.
  owner_insights__{branchId}__2026-07-09     → Phase 2: Turkish insight documents
  reception_today__{branchId}                → live: who's in, who's expected, unpaid alerts
  trainer_today__{trainerId}__2026-07-09     → her classes, her rosters, her occupancy only
  member_summary__{memberId}                 → Phase 2: her credits, her bookings
```

Every projection document carries its lineage:

```ts
{
  _projection: {
    name: 'owner_daily',
    version: 7,                       // bump ⇒ rebuild
    builtAt: Timestamp,
    throughEventId: 'evt_01J7Z…',     // watermark — ULID, so comparable
    builtBy: 'nightly' | 'trigger',
  },
  // … the payload the dashboard renders, verbatim, no client computation
}
```

**The owner's dashboard is one document read.** Not fifteen aggregation queries. This is a latency decision at one studio and a cost decision at a thousand.

**Projections are never repaired by hand.** Bump `version`, rebuild from events. This is why D5 is worth its ceremony: a wrong rule in the nightly batch is a bug fix and a rebuild, not a data-loss incident.

---

## 8. Security Rules Strategy

### Custom claims

Minted on user creation, re-minted on role change:

```ts
{ studioId: 'std_…', role: 'owner' | 'receptionist' | 'trainer', branchIds: ['brn_…'] }
```

Platform admin carries a **separate claim** (`platformAdmin: true`), never a studio role. Impersonation mints a short-lived token with the target studio and an `impersonating` marker that lands in every event (Doc 2 §11).

### The whole rule set, in essence

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    function tenant(sid)   { return request.auth.token.studioId == sid; }
    function role()        { return request.auth.token.role; }
    function branchOk(b)   { return b in request.auth.token.branchIds; }

    match /studios/{sid} {

      // ── Everything is readable by the tenant, subject to role. Nothing is writable. ──
      match /{col}/{docId} {
        allow read: if tenant(sid) && canRead(col, resource.data);
        allow write: if false;                      // ⚠ AD-15
      }

      // ── The one exception: clients create commands. ──
      match /commands/{cmdId} {
        allow create: if tenant(sid)
          && request.resource.data.actor.id == request.auth.uid
          && request.resource.data.type in ['checkIn.record', 'attendance.mark']
          && request.resource.data.status == 'pending'
          && cmdId == request.resource.data.id;      // idempotency key = doc id
        allow read:   if tenant(sid) && resource.data.actor.id == request.auth.uid;
        allow update, delete: if false;              // server-only
      }

      // ── Events are append-only, and not even the server appends from a client. ──
      match /events/{eventId} {
        allow read:  if tenant(sid) && role() == 'owner';
        allow write: if false;
      }
    }
  }
}
```

Three properties fall out, and they are the reason the shape is worth it:

1. **A cross-tenant read is not a filter you can forget. It is a path you cannot construct.** The `studioId` comes from the token, never from client input (D6).
2. **No client writes state.** Ever. The rule set has one `allow create` in it. A single developer can hold that in their head, and an AI coding agent cannot accidentally widen it.
3. **Events are immutable by construction.** Deletion is a compensating event, not a `delete`.

### Where role authorization actually lives (OQ-18)

Firestore rules gate **reads** and the one command `create`. They do **not** gate who may change the catalogue — and they must not, because *no client writes `/products` at all.* `allow write: if false` already covers it. Product writes go through Server Actions on the Admin SDK, which bypasses rules entirely (Doc 5 §13), so the authorization is a **role check in the Server Action**, not a rule:

| `/products` operation | owner | platform_admin | receptionist | trainer | member | Enforced by |
|---|---|---|---|---|---|---|
| read (list, sell against) | ✅ | ✅ | ✅ | ✅ | — | Firestore rule: `allow read: if tenant(sid)` |
| create · update · deactivate · reactivate | ✅ | ✅ | ❌ | ❌ | ❌ | **Server Action** `requireTenantContext(['owner','platform_admin'])` |

Reception sees every product and sells against it; she cannot change the price list. The rule set does not grow — this is the whole point of AD-15: authorization for a state write is a server concern, and only reads and the command whitelist reach the rules file. **OQ-18 adds nothing to `/products` in the rules; it adds one role tuple to three Server Actions.**

### The gotcha: rules are not filters

A trainer listing class sessions **must** include `where('trainerId','==', uid)` in the query itself. Firestore evaluates the rule against the *query*, not against the results — an unconstrained `list` is rejected outright, even if every returned document would have passed. This is correct behaviour and it surprises everyone once.

Consequence: **repositories build the constraining clause, not the UI.** `classSessionRepo.listForTrainer(ctx)` adds the `where` from the `TenantContext`. A repository method that takes a raw query is forbidden (Doc 5).

---

## 9. Identifiers

**Prefixed ULIDs.** `mem_01J7ZQK8…`, `evt_01J7ZQK9…`, `cmd_01J7ZQKA…`.

- **ULID** ⇒ lexicographically sortable by creation time. Event pagination becomes a `__name__` range with no index and no tie-breaking on equal timestamps.
- **Prefix** ⇒ a `memberId` can never be passed where an `entitlementId` is expected, and a stray id in a log line identifies itself. Branded TypeScript types enforce it at compile time; the prefix enforces it at 3 a.m.
- **Client-generated for commands.** The `commandId` must be minted offline, before any server is reachable. That is what makes it an idempotency key.

Firestore auto-ids are deliberately not used. They are random, unsorted, and anonymous.

---

## 10. Indexes

Composite indexes, derived from the query catalogue. Each is listed with the screen or job that needs it — **an index without a named consumer gets deleted.**

| Collection | Fields | Consumer |
|---|---|---|
| `classSessions` | `branchId ASC, startsAt ASC` | Reception & owner day view |
| `classSessions` | `trainerId ASC, startsAt ASC` | Trainer's own schedule (and the rule) |
| `classSessions` | `status ASC, endsAt ASC` | Attendance auto-resolver; session auto-complete |
| `reservations` | `classSessionId ASC, status ASC` | Class roster |
| `reservations` | `memberId ASC, sessionStartsAt DESC` | Member history; "upcoming classes" |
| `reservations` | `status ASC, sessionEndsAt ASC` | Attendance auto-resolver (AD-38) |
| `products` | `active ASC, category ASC, name ASC` | Catalogue screen; sell-entitlement picker (E4) |
| `entitlements` | `memberId ASC, status ASC, validUntil ASC` | Entitlement selection (OQ-7) — the hot path |
| `entitlements` | `status ASC, validUntil ASC` | "Expiring this week" |
| `entitlements` | `status ASC, validUntil ASC, credits.available DESC` | "Expiring **with unused sessions**" |
| `entitlements` | `balanceDue DESC, purchasedAt ASC` | "Tahsil edilmemiş" (OQ-10) |
| `payments` | `receivedAt DESC` | Daily revenue |
| `payments` | `memberId ASC, receivedAt DESC` | Member payment history |
| `checkIns` | `branchId ASC, occurredAt DESC` | Live occupancy |
| `events` | `related.memberId ASC, occurredAt DESC` | Member audit timeline |
| `events` | `type ASC, occurredAt ASC` | Rules engine; projection rebuild |
| `commands` | `status ASC, recordedAt ASC` | Stuck-command monitor |

The **entitlement selection** index is the one that runs on every single booking: `memberId + status + validUntil ASC` yields the earliest-expiring bookable entitlement as the first row. Doc 2 §7.4's rule was chosen partly *because* it maps to one index read.

---

## 11. Cost Model

Firestore bills reads. The design's whole posture toward cost is: **precompute, never fan out.**

| Operation | Reads | Note |
|---|---|---|
| Owner opens dashboard | **1** | one projection document |
| Reception opens today's schedule | ~15 | one day of sessions |
| Trainer opens a class roster | ~10 | reservations, with `memberSnapshot` denormalised — **0 member reads** |
| Book a class | 4 reads, 4 writes | one transaction |
| Check in a member | 1 write (command) + trigger | eventually consistent by design |

Per studio per day: **thousands** of operations, not millions. Firestore's free tier nearly covers a single studio; a thousand studios remains modest **because the dashboard is a document, not a query.**

The pathological alternative — an owner dashboard that runs fifteen aggregation queries on every load, times 1,000 studios, times a nervous owner refreshing — is the difference between a $20/month platform and a $2,000/month one, and it is a schema decision, not an optimisation.

---

## 12. Migration Collections

Kept apart from the domain, deliberately:

```
/studios/{sid}/_migration/{runId}                 run metadata, counts, checksums
/studios/{sid}/_migration/{runId}/rows/{rowId}    raw imported row, verbatim
```

Raw exports are also archived, **unparsed**, to Cloud Storage before any modelling (Doc 1 §16). Historical attendance becomes unrecoverable the day the incumbent's subscription lapses.

The importer emits real domain events with `actor: {type:'migration', id: runId}` and **historical `occurredAt` values**. Every imported fact is therefore attributable to its run, distinguishable from native data, and — critically — **excludable from analytics** if a run turns out to be dirty. Which one will be, somewhere.

The reconciler asserts every active entitlement's `credits.available` against the source export, and a human signs off. **A member with three sessions left will notice if she has eight.**

### What the importer must bring across (E1–E4)

| # | Thing | Rule |
|---|---|---|
| **E1** | Remaining credits | Exported explicitly by the incumbent. Imported as `credits.granted` with the consumption history replayed where available; otherwise seeded and **reconciled member-by-member**. A post-import correction is an `entitlement.adjusted` with `reason: 'migration'` and `actor: {type:'migration'}` — never a silent write. |
| **E2** | Attendance history | Imported as historical `reservation.*` events with real `occurredAt`. Rows the incumbent never marked carry `attendanceSource: 'system_default'` — because that is the truth about them, and pretending a trainer observed a class in 2024 would poison the very baseline the Phase 2 rules engine is meant to learn from. |
| **E3** | Phone numbers | Normalised to E.164 (§4.1.1). **Invalid or colliding numbers block the run.** They land in the validation report; a human decides. Never guessed, never merged. |
| **E4** | Product definitions | Imported from the source into `/products`. Historical variants become products with `active: false`, so the entitlements that reference them keep resolving. **No product name, price, or credit count is ever hardcoded** — not in the importer, not in a seed, not in a fixture. |

**Validation failures are not events** (Doc 4 §12). They are rows in `/_migration/{runId}/rows` with a rejection reason, and a report a human reads. An import with any rejected row does not proceed.

---

## 13. Forbidden Patterns

Written down because an AI coding agent will otherwise propose all of them, plausibly, at 2 a.m.

| ❌ | Instead |
|---|---|
| `collection('members')` at the root | Always `/studios/{sid}/members` via `TenantContext` |
| Any `collectionGroup()` query | Studio-scoped top-level collections (§3.2) |
| A repository method taking a raw path or query | Repositories build paths from `TenantContext` (§8) |
| Client SDK writing anything but `/commands` | AD-15 |
| `Date.now()` in domain code | Inject `now: Instant` |
| Floats for money | Integer kuruş |
| `serverTimestamp()` for `occurredAt` | `occurredAt` is domain time; `recordedAt` is `serverTimestamp()` |
| Mutating an event | Append a compensating event |
| Mutating a `Policy` document | Write a new `version` |
| Repairing a projection by hand | Bump `_projection.version`, rebuild |
| PII inside `event.payload` | Opaque ids in `event.related` |
| Storing `price` on the entitlement and calling it revenue | `priceAgreed` is debt; `Payment.amount` is revenue |
| A product name, price, or credit count in a source file | The catalogue is data. Import it, or seed it from a file the code does not read. (E4, AD-41) |
| A phone stored in Turkish local format | E.164, always. Normalise at the boundary or reject. (E3, AD-40) |
| The `system` actor emitting `reservation.attended` | It emits `reservation.auto_resolved`. (E2, AD-38) |
| An admin credit decrease landing in `consumed` | It lands in `revoked`. (Doc 2 §5.3) |

---

## 14. New Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| **AD-13** | Branches are a **field**, not a path segment. Flat studio-scoped collections. | Nested `/branches/{bid}/…` (Doc 1 §8) | The tenant is the studio. Nesting forced collection-group queries for cross-branch dashboards and bought no isolation. |
| **AD-14** | `credits.available` is stored, written only inside transactions | Compute on read | Makes "expiring with unused credits" an index, not a scan. |
| **AD-15** | **Clients read state; clients write commands.** One `allow create` in the entire rule set. | Client writes state, rules validate the domain | Rules cannot express a credit ledger. This is also what makes offline check-in possible without trusting the client. |
| **AD-16** | Prefixed ULIDs, client-generated for commands | Firestore auto-ids | Time-sortable events; idempotency keys mintable offline; type-confusion caught by eye. |
| **AD-17** | No collection-group queries in Phase 1 | Allow them, audit them | They are the mechanism by which tenant-scoped schemas grow cross-tenant read paths. |
| **AD-40** | **Phones are stored E.164, always.** The migration normalises; invalid or colliding numbers **block the run** and go to a validation report. | Store what the incumbent gave us; normalise on read | The phone is the member's identity in Türkiye and a future WhatsApp join key. A guessed number is a wrong member. *(E3, I-21)* |
| **AD-46** | **Catalogue writes are authorized in the Server Action (`owner` + `platform_admin`), not in a Firestore rule.** The rule stays `allow write: if false`; reception reads and sells. | A role-specific `allow write` on `/products` | No client writes state (AD-15). A write authz that lives in the rules file would be the first crack in that wall. *(OQ-18)* |

---

## 15. Resolved Decisions

| # | Question | Resolution |
|---|---|---|
| **OQ-12** | PII in reservation documents? | **Accepted, bounded.** `memberSnapshot` = `{ memberId, displayName, phoneLast4, membershipStatus }`. Nothing more. Built by `members.toMemberSnapshot()`. Never in events. Purged on erasure. (§4.4, AD-44) |
| **OQ-13** | Check-in trigger latency 1–3 s? | **Accepted.** Offline-safe check-in beats synchronous certainty in Phase 1. UI shows pending state optimistically. (AD-15 stands.) |
| **OQ-14** | Turkish name search? | **Accepted.** Phase 1: client-side filter over a cached member list. Typesense/Algolia deferred to Phase 2. |
| **E3** | Phone format? | **E.164, always.** Normalisation is total or the row is rejected. Collisions are reported, never merged. (§4.1.1, AD-40) |
| **OQ-18** | Who may write `/products`? | **owner + platform_admin.** Reception reads and sells; she does not edit the catalogue. Enforced in the Server Action, not a Firestore rule — no client writes state. (§8, AD-46) |

## 16. Open Questions

| # | Question | Blocks |
|---|---|---|
| **OQ-9** | *(carried)* Auto-check-out threshold. Suggest 4h. | Phase 2 |
| **OQ-11** | *(carried)* Unallocated payments do not auto-allocate. | Reception UI |
| **OQ-15** | Cached-member-list search (OQ-14) means the reception client holds **every member's PII in memory**, refreshed on load. At 300 members this is ~60 KB and unremarkable. At 5,000 it is a page-load cost and a wider blast radius if a tablet is stolen. Set a threshold at which Phase 2 search becomes mandatory — proposal: **2,000 members, or the first customer who asks.** | Phase 2 *(DEBT-001)* |
