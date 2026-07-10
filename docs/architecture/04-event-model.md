# 04 — Event Model

**Status:** Draft for review
**Depends on:** [01](./01-system-architecture.md), [02](./02-domain-model.md), [03](./03-firestore-data-model.md)
**Date:** 2026-07-09

---

## 1. Why This Document Exists

The event log is the only artefact of Phase 1 that **cannot be reconstructed later**.

State can be recomputed. Projections can be rebuilt. The UI can be rewritten. But an event that was never recorded — or was recorded without its actor, without its policy version, without an honest `occurredAt` — is gone. Every AI capability on the roadmap, every audit answer, every churn model, every explanation of why a member's credit disappeared, is downstream of decisions made in this document.

**Phase 1 writes events that nothing reads.** That is the investment. It is cheap precisely because nothing depends on it yet, and it is the reason the product can become what it is meant to become.

---

## 2. The Envelope

Every event, without exception, has this shape.

> **This is the canonical definition (AD-42).** Doc 3 §4.5 shows its Firestore projection and must match it field for field. An earlier draft of Doc 3 omitted `causationId` and `correlationId`; that was the bug, not this.

```ts
type DomainEvent<T extends EventType = EventType> = {
  // ── identity ──
  id: EventId                     // 'evt_' + ULID ⇒ lexicographically time-ordered
  studioId: StudioId              // the tenant. Redundant with the path; kept for exports.
  branchId: BranchId | null       // null ⇔ studio-wide (member registered, package sold)

  // ── what ──
  type: T                         // 'reservation.booked'
  version: number                 // payload schema version. Starts at 1.
  payload: PayloadOf<T>           // typed per event. Small. No PII. No entity snapshots.

  // ── when (D2 — two timestamps, always) ──
  occurredAt: Instant             // when it happened in the world
  recordedAt: Instant             // serverTimestamp(). When the system found out.

  // ── who (D4 — every actor is a principal) ──
  actor: ActorRef
  source: EventSource             // 'reception_tablet' | 'home_assistant' | …  ⚠ metadata only

  // ── about what ──
  subject: { kind: AggregateKind; id: string }
  related: {                      // opaque ids ONLY. This is the join key set. (I-13)
    memberId?: MemberId
    entitlementId?: EntitlementId
    classSessionId?: ClassSessionId
    reservationId?: ReservationId
    paymentId?: PaymentId
    trainerId?: StaffUserId
  }

  // ── why (D3 — decisions are explicable after the rules change) ──
  policyRef: { policyId: PolicyId; version: number } | null

  // ── causation ──
  commandId: CommandId | null     // idempotency key; the intent that caused this. Command path only.
  causationId: EventId | null     // the event that caused this event. Always null in Phase 1.
  correlationId: CorrelationId    // ⚠ REQUIRED, both write paths. One workflow, many events.
}
```

### The four fields people omit, and what each one costs

**`occurredAt` vs `recordedAt`.** A receptionist taps *"studio opened"* at 09:20 for a door that opened at 09:05. If these collapse into one field, *"the studio opened 15 minutes late"* is a lie the moment a human is in the loop — and in Phase 1 every producer *is* a human. All business rules read `occurredAt`. All sync, replay, debugging, and watermarking read `recordedAt`. They are never interchangeable.

**`actor` and `source`, kept apart.** `actor` is *who is responsible*. `source` is *what typed it in*. The same receptionist may act from a tablet or a desktop; the same `branch.opened` event may come from her finger or, in 2027, from a Zigbee door sensor whose actor is `{type:'device'}`. **Domain logic branches on neither.** The rule that computes lateness reads `occurredAt` and nothing else. That is D1 in one sentence, and this document exists largely to keep it true.

**`policyRef`.** The day the studio changes the cancellation window from six hours to four, every historical late cancellation must remain *correctly* late. Without the stamp, the "late cancellation rate" chart silently rewrites the past and every old dispute re-answers itself. Any event that reflects a policy decision carries the version it was decided under (I-12).

**`correlationId`.** One booking produces `reservation.booked` and `entitlement.credit_held`. One cancellation may produce three events. When something is wrong at 3 a.m. eight months from now, `correlationId` is what turns a list of rows into a story.

It is **required, on both write paths**, and `commandId` is not a substitute for it. `commandId` exists only where a `/commands` document exists — the offline path. A Server Action books a class with no command document at all, so its two events would share nothing. The server mints a `correlationId` per command handler invocation, whichever transport called it.

`causationId` is `null` for every event Phase 1 writes: events here are caused by commands, never by other events. It ships anyway, because Phase 2's projectors and Phase 4's agents *will* emit event-caused events, and a field added to the envelope in 2027 is permanently blank on everything written before it. Same asymmetry as the actor taxonomy — **cheap now, impossible later.**

---

## 3. Naming

`<aggregate>.<verb_in_past_tense>`, lowercase, snake_case verbs.

```
reservation.booked          ✅  it happened, it is a fact, it cannot be refused
reservation.book            ❌  that is a command
reservation.booking_failed  ❌  a rejected command is not a domain event (§12)
member.checked_in           ✅
door_sensor.triggered       ❌  the producer is not the fact — see below
```

### The rule that keeps the model future-proof

> **The producer never appears in the event type.**

A door sensor firing does not emit `device.door_opened`. It emits **`branch.opened`** with `actor: {type:'device', id:'door_main'}` and `source: 'home_assistant'`.

This is the entire payoff of the discipline. The lateness rule is written once, against `branch.opened`. When hardware replaces the receptionist's finger in 2027, *the rule does not change, the projection does not change, the dashboard does not change.* Only the producer changes.

The `device.*` namespace is reserved for facts that are genuinely **about the device** — `device.battery_low`, `device.went_offline`. Those are not business facts and the business rules do not read them.

### Is `reservation.auto_resolved` a producer in the type? No.

The rule above forbids naming the producer. `auto_` looks like it names one — the nightly job — and it is worth being precise about why it does not.

`auto_resolved` names the **absence of an observation**, which is a fact about the world, not about who noticed. If a turnstile resolves a reservation in 2027 by watching a member walk in, it emits `reservation.attended` with `actor: {type:'device'}` — because something *observed* her. If an AI agent closes out an unmarked roster in 2028 under the same policy default, it emits `reservation.auto_resolved` — because nothing did.

The test the rule actually encodes: **would swapping the producer change the type?** For `branch.opened`, no — so the producer must not appear. For `auto_resolved`, also no — a human, a job, and an agent applying a policy default all emit the same type. The distinction the type draws is epistemic, not mechanical, and that is exactly the distinction Doc 2 §8 is protecting.

### Refinement to Doc 2: `branch.opened`, not `studio.opened`

Doc 2 §9 wrote `studio.opened`. Wrong noun. **A door belongs to a branch**, and a studio with three branches has three opening times. Now that branch is a first-class dimension (AD-13), the event is `branch.opened`. Corrected here.

---

## 4. Payload Discipline — semi-fat events

Two failure modes, and the narrow path between them:

- **Thin events** (`{reservationId}` and nothing else) force every consumer to read current state to interpret the past. A projection rebuilt in 2028 would see today's balance, not the balance as it was. The log becomes a set of pointers into a mutable present, which is worthless for analytics and dishonest for audit.
- **Fat events** (the whole entity, snapshotted) bloat storage, duplicate PII, and freeze schema mistakes into the permanent record.

**Our rule: an event carries the delta, plus the post-state of every number it changed.**

```ts
// reservation.booked
{
  entitlementId: 'ent_…',            // which package paid (OQ-7's answer, recorded)
  creditEffect: 'held',
  creditsAvailableAfter: 4,          // ⚠ the post-state. Rebuilds without reading state.
  sessionStartsAt: '2026-07-14T16:00:00Z',
  sessionCapacity: 8,
  bookedCountAfter: 6,               // occupancy is computable from the log alone
  categoryMatched: 'pilates_group',
}
```

`creditsAvailableAfter` and `bookedCountAfter` look redundant. They are what let a projector answer *"what was the occupancy of that class at the moment she booked?"* years later, without a time-travelling read of a document that has since changed a hundred times.

**What never goes in a payload:** names, phone numbers, e-mail addresses, notes, free text a member wrote. Identity lives in `/members`; behaviour lives in events. That separation is what makes §14 possible.

---

## 5. Actors

```ts
type ActorRef =
  | { type: 'owner';          id: StaffUserId }
  | { type: 'receptionist';   id: StaffUserId }
  | { type: 'trainer';        id: StaffUserId }
  | { type: 'member';         id: MemberId }
  | { type: 'system';         id: SystemJobId }      // 'attendance_auto_resolver' | 'credit_expiry_sweep'
  | { type: 'ai_agent';       id: AgentId }          // 'receptionist_v3'   — Phase 3+
  | { type: 'device';         id: DeviceId }         // 'door_main'         — Phase 2+
  | { type: 'migration';      id: MigrationRunId }   // 'import_2026_07_12'
  | { type: 'platform_admin'; id: StaffUserId; impersonating?: StaffUserId }
```

All nine exist in the type from commit #1. Four are unused in Phase 1. **The type is the contract**; adding a member to it later is a schema migration across every historical event, which is precisely the thing that cannot be done retroactively.

Three consequences worth stating plainly:

**No borrowing.** The nightly attendance auto-resolver acts as `{type:'system', id:'attendance_auto_resolver'}`, not as the owner. When an AI agent first books a class in Phase 3, it books **as itself**, and the owner can see that it did, and can undo it. An AI that writes as a human is an AI whose mistakes are indistinguishable from her staff's.

**`migration` is a real actor.** Every imported historical fact is attributable to its import run, distinguishable from native data, and therefore **excludable from analytics** when a run turns out to be dirty. One will be. This costs nothing today and is unrecoverable later.

**`platform_admin` carries `impersonating`.** Support acts inside a customer's tenant, and the customer's own event log records that it happened. Every SaaS discovers it needs this after the first support escalation; it costs an hour in Phase 1.

---

## 6. Event Catalogue — Phase 1

Every event that Phase 1 writes. Nothing else is emitted; nothing here is optional.

### Studio & branch

| Type | `occurredAt` means | Payload | Producer (P1 → future) |
|---|---|---|---|
| `branch.opened` | the door actually opened | `{ scheduledOpenAt }` | receptionist → door sensor |
| `branch.closed` | the door actually closed | `{ occupancyAtClose }` | receptionist → door sensor |

### Member

| Type | Payload | Notes |
|---|---|---|
| `member.registered` | `{ homeBranchId, joinedAt }` | **No name.** Identity is in `/members`. |
| `member.profile_updated` | `{ changedFields: string[] }` | *which* fields, never their values |
| `member.deactivated` | `{ reason }` | |
| `member.checked_in` | `{ branchId, method, occupancyAfter }` | `method: 'reception'\|'qr'\|'device'` |
| `member.checked_out` | `{ branchId, method, durationMinutes, occupancyAfter }` | |
| `member.auto_checked_out` | `{ branchId, thresholdHours }` | actor: `system` (OQ-9) |

`member.profile_updated` records *that* the phone changed, never *to what*. The audit answer is *"reception changed her phone at 14:03"*; the value lives in `/members` and its history is not the event log's business.

### Entitlement — the credit ledger

| Type | Payload | Emitted when |
|---|---|---|
| `entitlement.purchased` | `{ productId, grant, priceAgreed, listPrice, validFrom, validUntil }` | reception sells |
| `entitlement.credit_held` | `{ reservationId, creditsAvailableAfter }` | booking |
| `entitlement.credit_released` | `{ reservationId, reason, creditsAvailableAfter }` | in-window cancel, class cancelled |
| `entitlement.credit_consumed` | `{ reservationId, reason, creditsAvailableAfter }` | attended, presumed attended, no-show, late cancel |
| `entitlement.credit_restored` | `{ reservationId, reason, creditsAvailableAfter }` | attendance correction gives a consumed credit back |
| `entitlement.frozen` | `{ from, freezeDaysUsed, freezeDaysRemaining }` | fitness only |
| `entitlement.unfrozen` | `{ to, daysFrozen, newValidUntil }` | `validUntil` shifts |
| `entitlement.adjusted` | `{ delta, reason, note, creditsAvailableAfter }` | ⚠ **admin override. `reason` AND `note` are mandatory.** |
| `entitlement.exhausted` | `{}` | last credit consumed |
| `entitlement.expired` | `{ grantKind, creditsExpired }` | ⚠ at `validUntil`. actor: `system`. **The churn signal.** |
| `entitlement.cancelled` | `{ reason, refundPaymentId? }` | |

### One expiry event, not two (AD-43)

An earlier draft carried both `entitlement.credits_expired` and `entitlement.expired`, firing at the same instant, on the same aggregate, with overlapping payloads. **`entitlement.credits_expired` is removed.**

They were never two facts. At `validUntil` the entitlement's status becomes `expired` and its unused credits burn, in one transaction, because they are the same event in the world. A period entitlement emits the same type with `grantKind: 'period'` and `creditsExpired: 0`. Two types would have forced every consumer to remember to read both, and forced the churn query to join them.

**`creditsExpired > 0` is the single most valuable behavioural signal Phase 1 produces.** A member who bought eight and used three is a member who is about to leave. It costs nothing to emit and it cannot be reconstructed after the fact.

The sweep is eager and nightly (AD-26), and it runs **after** the attendance auto-resolver, so nothing is held when an entitlement expires (I-19). An entitlement with `credits.held > 0` at `validUntil` is a bug, not a data condition: it is reported, never swept.

### Adjustment carries a reason *and* a note (AD-39)

```ts
// entitlement.adjusted
{ delta: -2,
  reason: 'correction',            // 'gift' | 'correction' | 'migration' | 'support'
  note:   'Çift kayıt: 12 Temmuz rezervasyonu iki kez düşülmüş',
  creditsAvailableAfter: 3 }
```

`reason` is a **closed enum** so that *"how many credits did we give away this quarter?"* is a query and not a text search. `note` is free text, mandatory, non-empty: the enum names the category, and only the human can name the case. A `reason` with no `note` is a shrug with a label on it.

**Both are enforced in the domain layer** — not by the UI, by the domain (AD-22). This is the event a member's dispute will hinge on, and a migration fix-up carries `reason: 'migration'` with `actor: {type:'migration'}`, so *"credits gifted"* excludes import repairs for free (I-20).

**There is no separate `credit_revoked` event.** `entitlement.adjusted` *is* the admin ledger movement, and the sign of `delta` says which counter moved — `restored` when positive, `revoked` when negative (Doc 2 §5.3). A second event would be the same fact written twice, which is the mistake AD-43 exists to correct. `entitlement.credit_restored` survives only for the *reservation-driven* case, where a correction hands back a credit that a class had consumed; it always carries a `reservationId`.

### Reservation

| Type | Payload | Actor |
|---|---|---|
| `reservation.booked` | `{ entitlementId, creditEffect, creditsAvailableAfter, sessionStartsAt, bookedCountAfter }` | receptionist, member |
| `reservation.cancelled` | `{ hoursBeforeStart, withinWindow: true, creditEffect: 'released' }` | receptionist, member |
| `reservation.late_cancelled` | `{ hoursBeforeStart, withinWindow: false, creditEffect }` | receptionist, member |
| `reservation.attended` | `{ source: 'trainer', minutesAfterStart, creditEffect: 'consumed' }` | **trainer, receptionist** |
| `reservation.no_show` | `{ source: 'trainer', creditEffect }` | **trainer, receptionist** |
| `reservation.auto_resolved` | `{ outcome: 'attended' \| 'no_show', source: 'system_default', creditEffect, creditsAvailableAfter }` | **`system` only** |
| `reservation.corrected` | `{ from, to, reason, source: 'correction' }` — ⚠ **never a silent edit** | owner, receptionist |

`hoursBeforeStart` is stored on the event even though it is derivable from `occurredAt` and `sessionStartsAt`. It is the **number the policy was evaluated against**, and freezing it means a dispute in November can be settled by reading one row instead of reconstructing a session that has since been rescheduled or deleted.

### `reservation.auto_resolved` — the presumption, written down as a presumption (AD-38)

This studio presumes that a reservation nobody cancelled was attended (E2, Doc 2 §8). The presumption is correct, operationally necessary, and **not an observation**, so it does not get the observation's event type.

```ts
// reservation.auto_resolved     actor: { type: 'system', id: 'attendance_auto_resolver' }
{ outcome: 'attended',           // ← policy.attendance.defaultOutcome
  source: 'system_default',
  creditEffect: 'consumed',
  creditsAvailableAfter: 4 }
// policyRef: { policyId: 'pol_…', version: 3 }     ⚠ I-12
```

Three consequences, each of which is the whole reason the type exists:

1. **`count(type == 'reservation.attended')` keeps meaning what it says** — people somebody watched walk into a class. Let the sweep write that type and the number becomes fiction, permanently, for every metric downstream of it.
2. **The no-show rate stays a real number.** Collapse the types and it is a structural zero: a member who booked eleven classes and attended none is indistinguishable from one who attended eleven.
3. **`source == 'system_default'` AND no `member.checked_in` that day** is the cheapest churn signal this system will ever have. Phase 1 already writes both events. The query is Phase 2's, and it is only writable because the types were kept apart today.

When `policy.attendance.defaultOutcome` is `no_show` — as it will be for a studio whose trainers take a real roster — the same event fires with `outcome: 'no_show'` and the credit burns per `policy.noShow.consumesCredit`. **Nothing in the code knows which studio believes what** (D3).

`markedBy` is gone from the payload: the envelope's `actor` already says who, and duplicating it invited the sweep to fill it in with a human's id.

### Class session

| Type | Payload |
|---|---|
| `class_session.scheduled` | `{ trainerId, branchId, category, startsAt, capacity }` |
| `class_session.cancelled` | `{ reason, reservationsReleased, creditsReturned }` |
| `class_session.completed` | `{ attendedCount, bookedCount, occupancyRate }` |
| `class_session.trainer_changed` | `{ from, to, reason }` |

`class_session.completed` carries `occupancyRate` — the number every capacity insight on the owner's dashboard aggregates. Computing it once, at the moment of truth, beats recomputing it forever from joins.

### Payment

| Type | Payload |
|---|---|
| `payment.recorded` | `{ amount, method, installments, allocations: [{entitlementId, amount}] }` |
| `payment.allocated` | `{ entitlementId, amount, balanceDueAfter }` |
| `payment.refunded` | `{ amount, reason, originalPaymentId }` |
| `payment.voided` | `{ reason }` |

Money is revenue on `payment.recorded.occurredAt` (cash basis, Doc 2 §6). A refund is a **new event**, never a mutation. The sum of `recorded − refunded − voided` over a window *is* the revenue figure, and it can be recomputed from the log at any time.

### Catalogue (E4)

The catalogue is data, and data that moves money is data with an audit trail.

| Type | Payload | Notes |
|---|---|---|
| `product.created` | `{ name, category, grant, price, policyId }` | owner, or `migration` on import |
| `product.updated` | `{ changedFields: string[], price? }` | `price` is carried because *"who raised Pilates 8 to ₺4,800, and when?"* is the question that gets asked |
| `product.deactivated` | `{ reason }` | `active: false`. Old entitlements keep resolving via `productSnapshot`. |
| `product.reactivated` | `{}` | |

**No product name, price, or credit count appears in a source file** (AD-41). These events are how the catalogue's history exists at all — there is no `Product` versioning, because `entitlement.productSnapshot` already froze what each member actually bought (Doc 2 §5.1).

`product.updated` carries `changedFields` **and** the new `price`, breaking the `member.profile_updated` convention (AD-25) on purpose: a price is not PII, and revenue analysis needs the number. Names and categories are not carried — those are read from `/products`.

### Policy, platform, migration

| Type | Payload |
|---|---|
| `policy.version_published` | `{ policyId, version, changedFields, effectiveFrom }` |
| `platform.impersonation_started` | `{ adminId, targetStudioId, reason, expiresAt }` |
| `platform.impersonation_ended` | `{ durationMinutes }` |
| `migration.run_started` | `{ source, rowCounts }` |
| `migration.run_reconciled` | `{ mismatches, signedOffBy }` |

`policy.version_published` with `changedFields` is how the owner later understands why her late-cancellation rate halved in March: she changed the window, and the log says so, next to the events it affected.

---

## 7. Reserved — Declared Now, Emitted Later

Named so the namespace is settled and no future phase has to fight for it.

| Phase | Types |
|---|---|
| **2** — waitlist, member portal | `reservation.waitlisted`, `reservation.promoted`, `member.portal_login` |
| **2** — devices | `device.battery_low`, `device.went_offline` *(device facts only)* |
| **3** — messaging | `message.sent`, `message.delivered`, `message.replied` |
| **3** — AI | `insight.generated`, `insight.dismissed`, `insight.acted_on`, `suggestion.approved`, `suggestion.rejected` |
| **4** — agents | `agent.action_proposed`, `agent.action_executed`, `agent.action_blocked_by_policy` |

Note what is **not** in the device row: `device.door_opened`. A door sensor emits `branch.opened` (§3). The reserved device namespace holds only facts about the hardware itself.

`insight.acted_on` and `insight.dismissed` are the future training labels. *"The system suggested calling four members; she called three; two renewed."* Without these events the AI never learns whether its advice was any good — and there is no way to add them retroactively. They are declared here so that when L1 ships, the feedback loop ships with it rather than eighteen months later.

---

## 8. Versioning and Evolution

**Events are permanent. Their schema is not.** The rules, in order of preference:

1. **Add optional fields.** No version bump. Old consumers ignore them.
2. **Never remove or repurpose a field.** A field that meant one thing in 2026 and another in 2028 is a landmine under every analysis that spans both.
3. **Never change a field's meaning.** Add `hoursBeforeStartV2`; leave the original.
4. **Breaking change ⇒ bump `version`, write an upcaster.**

```ts
// events/upcasters/reservation.booked.ts
const upcasters: Upcaster[] = [
  { from: 1, to: 2, up: (p) => ({ ...p, categoryMatched: 'pilates_group' }) },  // added Aug 2026
]
// Consumers read only the latest shape. Storage keeps the original bytes forever.
```

Upcasting happens on **read**, never by rewriting stored events. A stored event is a historical fact; rewriting it is falsifying the record.

---

## 9. Ordering, Idempotency, Watermarks

**Ordering.** Event ids are ULIDs, so `orderBy('__name__')` *is* chronological order by `recordedAt`, with no index and no tie-breaking. Note carefully: this is **arrival order**, not `occurredAt` order. A migration import writes events with 2024 `occurredAt` values today. Projectors that care about business chronology sort by `occurredAt`; projectors that care about "what have I already processed" use the ULID watermark. Conflating them is the subtlest bug available in this design.

**Idempotency.** `commandId` is client-generated (§AD-16) and doubles as the `/commands` document id. Before any transaction appends an event, it checks whether an event with that `commandId` already exists. A double-tapped check-in button, a retried Server Action, an offline queue replayed twice — all converge to one event. This is four lines of code, and without them invariant I-2 (`held` equals the count of booked reservations) is fiction.

**Watermarks.** Every projection stores `throughEventId`. A rebuild reads events after that ULID. Because ULIDs sort, "give me everything since" needs no index. This is the mechanism by which a projection is disposable (Doc 1 §10): delete it, bump `_projection.version`, replay from `evt_0`.

---

## 10. The Write Path, Exactly

```ts
await db.runTransaction(async (tx) => {
  // 1. READS FIRST — Firestore requires it
  const [entitlement, session, existing] = await Promise.all([
    tx.get(entitlementRef), tx.get(sessionRef), tx.get(eventByCommandIdQuery),
  ])

  // 2. IDEMPOTENCY
  if (!existing.empty) return                                   // already applied

  // 3. DECIDE — pure. no I/O, no clock, no randomness.
  const events = decideBooking(
    { entitlement, session }, policy, command, now, actor,      // `now` is injected
  )                                                             // throws on invariant violation

  // 4. WRITE — state and events, atomically
  tx.update(entitlementRef, applyCreditHold(entitlement))
  tx.update(sessionRef, { bookedCount: FieldValue.increment(1) })
  tx.set(reservationRef, newReservation)
  for (const e of events) tx.set(eventRef(e.id), e)             // ⚠ same transaction
})
```

**If state and events can drift, the log is decorative and every conclusion drawn from it is suspect.** They commit together or not at all. Firestore gives us this within a tenant, which is exactly the scope we need.

Downstream, a **single trigger** on `/studios/{sid}/events/{eventId}` fans out to projectors. One trigger, one dispatch table, registered per event type. Not one trigger per collection — that would put projection logic next to state writes and make the "projections are disposable" promise a lie.

---

## 11. Consumers

```
                       /studios/{sid}/events
                                │
        ┌────────────┬──────────┴──────────┬────────────────┐
        ▼            ▼                     ▼                ▼
   Projectors    Rules engine         Audit trail     Corpus export
   (trigger)     (nightly, P2)        (owner UI)      (P3, §14)
        │            │
        ▼            ▼
  role-scoped    insight documents
  read models    (Turkish, P2)
```

Four consumers, one log. **Phase 1 builds only the audit trail** — the owner can read a member's timeline and see every credit that ever moved and who moved it. Everything else is Phase 2 or later, reading events that Phase 1 has been quietly accumulating for months.

### The consumer that reads what is *not* there

*"Reception has not checked in 3 arriving members."*

No event says this. It is a **scheduled rule** comparing expected arrivals (reservations whose `sessionStartsAt` is within the next fifteen minutes) against observed `member.checked_in` events. Reasoning about the **absence** of an event is the most interesting computation on the owner's dashboard, and it is why the event log must be complete rather than merely convenient: an absence is only meaningful if presence would have been recorded.

This is pure L0 rules engine. No AI. (Doc 1 §11.)

---

## 12. What Is *Not* an Event

| Not an event | Why | Where it lives |
|---|---|---|
| A rejected command | Nothing happened in the business. A member who *tried* to book a full class did not change the world. | `commands/{id}.status = 'rejected'`, with `result.error` |
| A page view, a click | Not a business fact. | Analytics, later, elsewhere |
| A raw sensor reading | 2,880 temperature readings/day/device, read only as aggregates. | Pub/Sub → BigQuery (Doc 1 §12) |
| A validation error | A bug or a typo, not history. | Logs |
| A read | Reads are not facts about the business. | — |

The pressure to log rejected commands as events will be constant, because it feels like useful data. It is useful — as **operational telemetry**, in `/commands`, with a TTL. It is not history. An event log that contains things that did not happen is a log nobody can trust to answer *"what happened?"*

---

## 13. Corrections and Compensating Events

**No event is ever updated. No event is ever deleted.** A mistake is corrected by appending its correction.

```
20:15  reservation.auto_resolved    actor: system  { outcome: 'attended',
                                                     source: 'system_default',
                                                     creditEffect: 'consumed' }
09:40  reservation.corrected        actor: owner   { from: 'attended', to: 'no_show',
                                                     source: 'correction',
                                                     reason: 'Üye gelmedi; eğitmen ertesi
                                                              gün bildirdi' }
09:40  entitlement.credit_restored  actor: owner   { reservationId: 'res_…',
                                                     reason: 'attendance_correction' }
```

The audit trail then reads, correctly and completely: *the policy presumed, a human disagreed, here is why, here is what changed.* Eight months later, when the member disputes a credit, the answer is one query away.

The alternative — editing the resolved outcome in place — produces a system in which the past is whatever the present says it is. Every credit dispute becomes unwinnable, and *"how often is the presumption wrong?"* — a number this studio will want the moment it considers charging for no-shows — returns zero forever.

Note what the two rows make possible together: because the sweep wrote `auto_resolved` rather than `attended`, the correction rate is measurable **against the presumption specifically**, not against attendance in general. That is AD-38 paying for itself in the first month.

**`reason` is mandatory** on `entitlement.adjusted`, `reservation.corrected`, `class_session.cancelled`, `product.deactivated`, and `payment.refunded`. Enforced in the domain layer, not the UI.

---

## 14. Privacy, De-identification, Erasure

### Crypto-shredding by design

Because **no event payload contains PII** (I-13), and events reference members only by opaque id, the entire event log is *already* pseudonymous. This is not a convenience; it is the load-bearing property of the whole privacy design.

A KVKK/GDPR erasure request therefore becomes:

1. Delete `/studios/{sid}/members/{memberId}` — the only document holding name, phone, e-mail, notes.
2. Purge `memberSnapshot.displayName` and `phoneLast4` from that member's reservations (Doc 3 §4.4 — the sole reason erasure is not a one-document delete).
3. **Stop.** The event log now describes an anonymous person. It stays intact, and the business analytics, occupancy history, and revenue records remain correct.

Contrast with the alternative universe where events carry names: erasure means rewriting an immutable log, which is either impossible or a lie. **The decision made in Doc 1 (AD-10) is what buys this**, and it cost nothing at the time.

### The cross-tenant corpus (Level-2 learning)

Anonymised cross-studio learning is a **projection**, not a scrubbing script.

```ts
// exported to BigQuery. Never Firestore. Never readable by another tenant.
{
  studioHash:  hmac(exportSalt, studioId),     // per-export salt ⇒ not linkable across exports
  memberHash:  hmac(exportSalt + studioId, memberId),
  type: 'reservation.booked',
  occurredAt, dayOfWeek: 2, hourOfDay: 19,
  category: 'pilates_group',
  sessionCapacity: 8, bookedCountAfter: 6,
  creditsAvailableAfter: 4,
  // no ids, no names, no studio identity, no prices
}
```

Three properties, deliberate:

- **Per-export salt.** Two exports cannot be joined to track an individual across time.
- **Studio identity is hashed too.** A benchmark says *"studios like yours average 71% Tuesday occupancy"*, never *"Studio Moda averages 71%."*
- **No prices.** Revenue benchmarks, if ever built, are computed inside the tenant and only *ratios* are exported.

Whether this export may legally happen at all, on what consent basis, and with what data-processing agreement — **OQ-4, for counsel, before customer #2 signs.** The architecture keeps the door open. It does not decide to walk through it.

---

## 15. Retention

| Data | Retention | Mechanism |
|---|---|---|
| Events | **Forever.** Immutable. | Rules deny `update`/`delete` to everyone, including the server SDK by convention |
| Commands | 30 days after `applied` | Firestore TTL on `expiresAt` |
| Projections | Disposable; rebuilt on demand | `_projection.version` bump |
| Raw migration exports | Forever, in Cloud Storage, unparsed | Written before any modelling |
| Member PII | Until erasure request or 5 years after last activity | Manual, then §14 |

Event storage cost, sized honestly: one studio produces on the order of **200–500 events per day**. At ~1 KB each, that is under 200 MB per studio per year — a few cents. A thousand studios is a few hundred dollars a year for the entire history of the platform. **There is no scenario in which deleting events saves meaningful money, and every scenario in which having them is the product.**

---

## 16. Testing the Event Model

The event log is a **contract**, and contracts get golden tests.

1. **Decision functions are pure** ⇒ table-driven unit tests, no emulator, milliseconds. *Given this entitlement, this policy, this clock, cancelling produces exactly these events.* This is where the credit and freeze arithmetic is proven.
2. **Golden fixtures.** A committed JSON file per event type. A change to a payload shape fails the test, forcing the author to choose: additive field (fine) or version bump plus upcaster (deliberate). **This is the single most valuable test in the repository**, because it makes schema drift impossible to do accidentally — including by an AI coding agent at 2 a.m.
3. **Invariant tests.** Doc 2 §15's **twenty-one** invariants, as property tests over generated command sequences. Book, cancel, freeze, adjust, auto-resolve, in random order; assert `available ≥ 0`, `held == count(booked)`, and that no `system`-actor event ever carries type `reservation.attended` (I-18).
4. **Projection rebuild test.** Replay a fixture event stream twice; assert the projection is byte-identical. This proves projections are actually disposable, which is a promise made in three documents and worth exactly nothing until it is tested.

---

## 17. New Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| **AD-18** | `<aggregate>.<verb_past>`; **the producer never appears in the event type** | `device.door_opened`, `reception.checked_in_member` | A sensor replacing a human must not change a single rule. This is D1's concrete form. |
| **AD-19** | Semi-fat payloads: delta + post-state of changed numbers | Thin events (pointers) / fat events (snapshots) | Projections rebuildable from the log alone, without PII duplication. |
| **AD-20** | Rejected commands are **not** events | Log everything as events | An event log containing things that did not happen cannot answer "what happened?" |
| **AD-21** | Upcasting on read; stored events are never rewritten | Migrate historical events | Rewriting a fact is falsifying the record. |
| **AD-22** | `reason` mandatory on adjustment, correction, cancellation, refund — enforced in the **domain**, not the UI | Optional note field | These are the events every dispute turns on. |
| **AD-23** | ULID ordering = arrival order; business chronology = `occurredAt` | One ordering for both | Migration writes 2024 events today. Conflating the two is the subtlest bug in the design. |
| **AD-24** | `insight.acted_on` / `.dismissed` declared now | Add when AI ships | They are the AI's future training labels and cannot be captured retroactively. |
| **AD-25** | `member.profile_updated` carries changed **field names**, never values | A full before/after audit | Keeps PII out of the event path entirely — the property that makes crypto-shredding (§14) work. |
| **AD-26** | Credit expiry is an **eager nightly sweep**, not lazy evaluation on read | Compute expiry when someone looks | `entitlement.expired` with `creditsExpired > 0` is the churn signal. A signal that only exists when observed is not a signal. |
| **AD-38** | **The `system` actor never emits `reservation.attended`.** A reservation nobody marked is resolved by `policy.attendance.defaultOutcome` and emitted as `reservation.auto_resolved`. Every attendance outcome carries `source`. | The sweep writes `reservation.attended` directly | The credit consequence is identical; the epistemics are not. Collapsing them makes the no-show rate a structural zero and destroys the churn signal, unrecoverably. `source` cannot be backfilled. *(E2, I-18)* |
| **AD-39** | `entitlement.adjusted` carries a **closed-enum `reason`** (`gift \| correction \| migration \| support`) and a mandatory non-empty `note` | A single free-text reason field | *"How many credits did we give away?"* must be a query, not a text search. The enum names the category; only the human names the case. *(E1, I-20)* |
| **AD-42** | The **canonical envelope is §2**, including required `correlationId` and nullable `causationId`. Doc 3 §4.5 mirrors it. | Drop them; derive correlation from `commandId` | A Server Action has no command document, so `commandId` cannot correlate its events. Neither field can be backfilled onto history. |
| **AD-43** | **One expiry event: `entitlement.expired`.** `entitlement.credits_expired` is removed. | Two events, one for status and one for the ledger | They fire in the same transaction on the same aggregate at the same instant. They were one fact written twice. |

---

## 18. Resolved Decisions

| # | Question | Resolution |
|---|---|---|
| **OQ-16** | Does `member.profile_updated` record old/new values? | **No.** Changed field *names* only. PII never re-enters the audit/event path. (AD-25) |
| **OQ-17** | Lazy or eager credit expiry? | **Eager nightly sweep.** `entitlement.expired` is written at the moment expiry happens — never invented lazily when someone reads the data. It runs *after* the attendance auto-resolver (I-19). (AD-26, AD-43) |
| **E2** | How is an unmarked reservation recorded? | `reservation.auto_resolved`, `source: 'system_default'`, outcome from policy. Never `reservation.attended`. (§6, AD-38) |
| **E4** | Does the catalogue emit events? | **Yes.** `product.created` / `.updated` / `.deactivated` / `.reactivated`. Every state change appends an event; a price list that moves money is not an exception. |
| **Envelope** | `causationId` / `correlationId` — in or out? | **Both in.** `correlationId` required, `causationId` nullable and always `null` in Phase 1. (AD-42) |

## 19. Open Questions

| # | Question | Blocks |
|---|---|---|
| **OQ-4** | *(carried, counsel)* Legal basis for the Level-2 corpus export. | Customer #2 |
| **OQ-9, OQ-11, OQ-15** | *(carried)* | — |
