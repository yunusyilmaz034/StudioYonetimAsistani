# 02 — Domain Model

**Status:** Draft for review
**Depends on:** [01 — System Architecture](./01-system-architecture.md)
**Date:** 2026-07-09

---

## 1. Purpose

This document defines the **language, the aggregates, the invariants, and the state machines** of the business. It is deliberately free of Firestore, Next.js, and Firebase. Everything here is plain TypeScript and plain reasoning.

That separation is the point. Document 3 will map this onto Firestore. If the mapping is ugly, we change the mapping — not the model.

Per **AD-7**, the domain layer imports nothing from a framework. It has no clock, no I/O, no randomness. It is the only part of the system with genuinely hard logic, and it must be exhaustively testable without an emulator.

---

## 2. Ubiquitous Language

The business speaks Turkish. The code speaks English. This table is the treaty; it is binding on both.

| English (code) | Türkçe | Meaning — the precise sense we use |
|---|---|---|
| Studio | Stüdyo | The **tenant**. The billing boundary. |
| Branch | Şube | A physical location belonging to a studio. |
| Member | Üye | A person who buys and attends. Never called "customer" or "user." |
| Staff | Personel | Owner, reception, or trainer. A `User`, never a `Member`. |
| Product | Ürün | A sellable thing in the catalogue: *"8 Ders Pilates Paketi"*. |
| Entitlement | Hak / Üyelik | **What a member owns after buying.** The instance, not the catalogue item. |
| Credit | Ders hakkı | One unit of entitlement. Consumed by attending. |
| Class Session | Ders | One scheduled, dated, timed class with a trainer and a capacity. |
| Reservation | Rezervasyon | A member's claim on a seat in a class session. |
| Check-in | Giriş | A member **physically entering the studio**. |
| Attendance | Yoklama | A member **being present in a class**. |
| Attendance source | Yoklama kaynağı | *Who says so:* an observer (`trainer`), the policy default (`system_default`), or a later correction. |
| Freeze | Dondurma | Suspending a period entitlement; the end date shifts forward. |
| No-show | Gelmedi | Reserved, never attended, never cancelled. |
| Late cancellation | Geç iptal | Cancelled inside the policy window. |
| Payment | Ödeme | Money received. Cash, transfer, or card. |
| Policy | Kural | A versioned, studio-owned rule set. |

### The distinction that matters most

**Check-in is not attendance.**

- `member.checked_in` — Ayşe walked through the door. Reception tapped, or a QR was scanned, or (later) a turnstile fired. This produces **occupancy**: *"There are currently 23 members inside."*
- `reservation.attended` — Ayşe was **observed** present in the 19:00 reformer class, and somebody says so. This produces **credit consumption** and every attendance-based metric.

They are different events, from different producers, with different consequences. A member can check in for a coffee and never attend. A member can attend without anyone remembering to check her in. Conflating them — which almost every booking system does — makes both occupancy and attendance permanently untrustworthy.

### The second distinction, which is easier to lose

**Attendance is not the same as its policy default.**

In this studio, a reservation that is never cancelled is *presumed* attended (§8). That is a correct and necessary operational rule — nobody is going to chase a trainer for a roster tick before the credit ledger can settle. But a presumption is not an observation, and the log must not pretend otherwise.

So the sweep emits **`reservation.auto_resolved`**, never `reservation.attended`, and every attendance outcome carries a `source`:

| `source` | Means | Producer |
|---|---|---|
| `trainer` | somebody watched the class and said so | trainer, or reception in Phase 1 |
| `system_default` | nobody said anything; the policy default applied | `system` |
| `correction` | an earlier outcome was overturned, with a reason | owner, reception |

The credit consequence is identical either way — which is exactly why it is tempting to collapse them, and exactly why we do not. Collapse them and the no-show rate becomes a structural zero, a member who quietly stopped coming looks like a perfect attender, and *"presumed attended but never checked in"* — the cheapest churn signal this system will ever have — is unaskable. None of it can be recovered afterwards, because the information was never written down. **AD-38.**

---

## 3. Aggregates

An **aggregate** is a consistency boundary: everything inside it is transactionally consistent; anything outside is eventually consistent. Choosing these boundaries *is* the domain model.

```
Studio (tenant root)
├── Branch
├── StaffUser
├── Policy                    ← versioned; referenced, never mutated in place
├── Product                   ← catalogue
├── Member                    ← identity + PII (never enters an event)
│   └── Entitlement           ← what she owns; holds the credit balance
├── ClassSession              ← the class; holds the seat count
│   └── Reservation           ← a member's seat  ⚠ see §7
├── Payment                   ← money received
└── Event                     ← immutable, append-only
```

### Why `Reservation` sits awkwardly

A reservation touches three aggregates at once: it consumes a **seat** on `ClassSession`, it holds a **credit** on `Entitlement`, and it belongs to a `Member`. Classic DDD would agonise over this.

We do not. **A booking transaction spans `Reservation` + `ClassSession` + `Entitlement`, atomically.** Three documents in one Firestore transaction is entirely ordinary, and the alternative — eventual consistency between "you have a seat" and "you paid a credit for it" — produces exactly the bugs that make members lose trust. Purity loses to correctness here, deliberately.

Everything else is eventually consistent: projections, counters, dashboards, insights.

---

## 4. Member

```ts
type Member = {
  id: MemberId                     // opaque. The ONLY thing events may reference.
  studioId: StudioId               // studio-scoped: branches share members (AD-13, OQ-2)
  homeBranchId: BranchId | null    // preference, not a constraint

  // ── PII. Never enters an event payload. (AD-10) ──
  fullName: string
  phone: PhoneNumber               // E.164. The de-facto identity in Türkiye.
  email: Email | null
  birthDate: LocalDate | null
  notes: string | null             // free text; injury history, preferences
  emergencyContact: Contact | null

  // ── lifecycle ──
  status: 'active' | 'inactive' | 'deleted'
  joinedAt: Instant

  // ── projected, never authoritative. Rebuildable from events. ──
  readonly stats: {
    lastAttendanceAt: Instant | null
    lastCheckInAt: Instant | null
    totalAttended: number
  }
}
```

**PII segregation is a hard rule, not a preference.** An event says *"member `m_a91f` consumed a credit at 19:04."* It never says *"Ayşe Yılmaz."* This is what makes the Level-2 anonymised cross-tenant corpus a **projection** rather than a scrubbing script written under legal pressure three years from now (§13 of Doc 1).

`stats` is denormalised for the reception screen and is **always rebuildable**. If it disagrees with the events, the events are right.

---

## 5. Product and Entitlement — the central distinction

> *"Please model payment, membership/package, reservation, attendance, and credit consumption as separate concepts. They are related but not the same thing."*

Taken literally. This section is where that instruction lives.

### 5.1 Product — the catalogue item

**The catalogue is data, not code.** The owner creates, edits, and deactivates products; the migration imports the incumbent's definitions. **No product name, price, credit count, or validity period is ever written in a source file** — not in a constant, not in a seed, not in a test fixture that something else reads. Products are rows. *(E4, AD-41.)*

```ts
type Product = {
  id: ProductId
  studioId: StudioId
  name: string                     // "8 Ders Pilates Paketi" — data. Never a literal in code.
  category: Category               // ⚠ a CLOSED enum. See below.

  grant: CreditGrant | PeriodGrant   // ← what buying it gives you
  price: Money
  policyId: PolicyId                 // which rule set governs it
  active: boolean                    // withdrawn products stay referenced by old entitlements
}

type Category = 'pilates_group' | 'fitness' | 'private'

type CreditGrant = {
  kind: 'credits'
  credits: number                  // 8 | 16
  validForDays: number             // 30 | 60
}

type PeriodGrant = {
  kind: 'period'
  durationDays: number             // 90 | 180
  access: 'unlimited'
}
```

The first customer's catalogue happens to contain five products. **This is an observation about one tenant's data, not a fact the code may rely on.** Studio #47 will have eleven.

| Product *(customer #1, imported)* | Grant | Policy |
|---|---|---|
| Pilates 8 | `credits: 8, validForDays: 30` | 6h cancel, **no freeze** |
| Pilates 16 | `credits: 16, validForDays: 60` | 6h cancel, **no freeze** |
| Fitness 3 Months | `period: 90d, unlimited` | freeze: **7 days** |
| Fitness 6 Months | `period: 180d, unlimited` | freeze: **14 days** |
| PT | `credits: n, validForDays: n`, `category: 'private'` | distinct pricing |

### Why `category` is a closed enum while everything else is data

`name`, `price`, `grant`, `validForDays` are free. `category` is not, and the asymmetry is deliberate: **the category wall (I-9.7) is enforced by comparing `entitlement.productSnapshot.category` to `session.category`.** If a category could be minted by typing a new string into an admin form, the wall becomes stringly-typed, a typo silently opens the reformer room to a fitness membership, and no test can catch it.

Adding a category is therefore a code change, on purpose. It is the one place where the catalogue's flexibility is bought back for correctness. *(Correctness > Extensibility.)*

### Products are edited in place; history is protected by the snapshot

An earlier draft required a new product *version* on every price change. That was ceremony solving a problem `productSnapshot` had already solved: **an entitlement freezes what was actually bought at the moment of purchase** (§5.2), so a later edit to the catalogue cannot reach backwards and rewrite what a member paid for.

So: edit freely. Deactivate (`active: false`) to withdraw a product without orphaning the entitlements that reference it. Every write emits `product.created` / `product.updated` / `product.deactivated` / `product.reactivated`, so *"who changed the price of Pilates 8, and when?"* is an audit query.

**Who may write it (OQ-18, resolved): `owner` and `platform_admin`, nobody else.** A product is a price list; reception *reads* it and *sells* against it, but she does not set prices, and a trainer and a member never touch it. This is authorized in the catalogue Server Actions — `requireTenantContext(['owner','platform_admin'])` — not in a Firestore rule, because no client writes state (AD-15, AD-46). The reception UI simply has no create/edit affordance; the enforcement is on the server regardless.

**Policy versioning stays as it was.** A policy is not a product: a policy governs decisions that must remain explicable after the rule changes (D3), and it is versioned as a new document. A product only has to remain *legible*, and the snapshot does that.

### 5.2 Entitlement — what a member owns

One aggregate, two shapes, discriminated by `grant.kind`. **Not two separate types**, because they share a lifecycle, a validity window, and a reservation flow, and duplicating that logic is how the credit and freeze rules drift apart.

```ts
type Entitlement = {
  id: EntitlementId
  studioId: StudioId
  memberId: MemberId
  productId: ProductId
  productSnapshot: ProductSnapshot   // what she actually bought, frozen at purchase
  policyVersion: PolicyVersionRef    // ⚠ D3 — the rules AS THEY WERE at purchase

  status: EntitlementStatus
  validFrom: Instant
  validUntil: Instant                // freeze moves this forward

  credits: CreditLedger | null       // null ⇔ period entitlement
  freeze: FreezeState | null         // null ⇔ freezing not permitted

  // ── what was owed, and what has been collected (OQ-10: payment is optional) ──
  priceAgreed: Money                 // may differ from productSnapshot.price ⇒ discount
  paidTotal: Money                   // sum of allocations. Denormalised, rebuildable.
  readonly balanceDue: Money         // priceAgreed − paidTotal. ≥ 0 ⇒ debt. < 0 ⇒ credit on account.

  purchasedAt: Instant
}
```

**`priceAgreed` vs. `productSnapshot.price` is a deliberate, nearly-free seam.** The list price is ₺4,200; the member paid ₺2,940 during a Wednesday-morning campaign. Storing both means the discount is *visible* — `discount = productSnapshot.price − priceAgreed` — without building the `Discount` entity that §14 defers. Revenue-per-product analytics stay honest, and when real campaigns arrive in Phase 2 they attach a `campaignId` to an existing field rather than forcing a schema change.

`paymentIds` is **gone**. Payments allocate *amounts*, not just identities — see §6.

### 5.3 The credit ledger — hold, consume, release

This is the heart of the model, and the place where naïve systems break.

**A balance is not a single number.** Consider: a member with one remaining credit opens the booking screen and books five classes. If a credit is only consumed at *attendance*, she has legally booked five seats she cannot pay for, and four other members were turned away.

Therefore booking **holds** a credit. The lifecycle:

```
              ┌──────────┐
              │ granted  │  purchase → 8 credits
              └────┬─────┘
                   │ reserve                       admin, with a reason:
                   ▼                               ┌──────────┐
              ┌──────────┐                         │ revoked  │  available −1
        ┌─────│   held   │─────┐                   └──────────┘
        │     └──────────┘     │                   ┌──────────┐
        │ cancel in window     │ attend | no-show  │ restored │  available +1
        │                      │ | late cancel     └──────────┘
        ▼                      ▼                        ▲
   ┌──────────┐          ┌──────────┐                   │
   │ released │          │ consumed │───────────────────┘
   └────┬─────┘          └──────────┘   reversed only by a compensating
        │ back to available              adjustment — never by an edit
        ▼
   (available again)

   at validUntil, once nothing is held:  available → expired
```

```ts
type CreditLedger = {
  granted: number       // what the product gave. Set at purchase, never touched again.
  held: number          // open reservations not yet resolved
  consumed: number      // spent through a RESOLVED reservation: attended, no-show, late cancel
  restored: number      // a consumed credit given back: attendance correction, admin gift
  revoked: number       // an admin adjustment took a credit away  ⚠ never `consumed`
  expired: number       // burned at validUntil, unused

  // derived — never stored as truth, but denormalised for reads (AD-14):
  readonly available: number
  // = granted + restored − consumed − held − revoked − expired
}
```

**Six counters, all monotonically non-decreasing** (I-3). `revoked` exists so that an admin taking a credit back never lands in `consumed`. If it did, *"how many credits were actually spent in classes?"* — the denominator of every utilisation number the owner will ever look at — would silently include the owner's own corrections. An in-window cancellation needs no counter at all: it simply decrements `held`.

### "One credit is deducted immediately" — and it is (E1)

The remaining credits a member sees drop **the instant she books**. Booking increments `held`, and `held` is subtracted from `available`: eight becomes seven, immediately, exactly as the incumbent platform behaved.

What the `held` bucket buys is not a different number — it is **reversibility, and the ability to say why**:

```
booking            held++              available 8 → 7
cancel in-window   held−−              available 7 → 8      (released — no counter moves)
attended           held−−, consumed++  available stays 7
no-show            held−−, consumed++  available stays 7    (if policy burns)
late cancel        held−−, consumed++  available stays 7    (if policy burns)
admin gift         restored++          available 7 → 8      (with a reason)
admin take-back    revoked++           available 7 → 6      (with a reason)
```

Consuming at booking time would collapse the four resolutions into one counter, make an in-window cancellation indistinguishable from an admin correction, and leave I-2 (`held` equals the count of open reservations) with nothing to say. The member's arithmetic is identical; the studio's ability to explain it is not.

**Invariants (I-1 … I-4):**

- **I-1** `available ≥ 0` — always. A booking, or an admin decrease, that would drive it negative is **rejected, never clamped**.
- **I-2** `held ≥ 0` and `held` equals the count of reservations in state `booked` against this entitlement.
- **I-3** Only monotonically non-decreasing counters are ever written: `consumed`, `restored`, `revoked`, `expired` never decrease. Corrections are **new ledger entries**, never edits. (D5: compensating events, not silent overwrites.)
- **I-4** `expired > 0` ⟹ `status === 'expired'` and no further reservation is possible.

**Unused expired credits are the churn signal, not a financial one.** Revenue was recognised at payment (§6). A member who bought eight and used three is a member who is about to leave. That is the more valuable read, and it falls out of `expired > 0` for free.

**Period entitlements have `credits: null`.** Booking checks capacity and validity only. No hold, no consumption. A no-show against a period entitlement records the event (it is a behavioural signal, and the rules engine will want it) but burns nothing.

### 5.4 Freeze

```ts
type FreezeState = {
  entitledDays: number             // 7 (3-month) | 14 (6-month) — from policy
  usedDays: number
  periods: FreezePeriod[]          // closed intervals, never overlapping
  activeFrom: LocalDate | null     // non-null ⇔ currently frozen
}
```

**Invariants (I-5 … I-8):**

- **I-5** `usedDays ≤ entitledDays`.
- **I-6** Freeze periods never overlap.
- **I-7** A freeze **may not start in the past.** Retroactive freezing is an admin adjustment with a reason, not a freeze. (This is the single most common source of *"why does my dashboard disagree with reality."*)
- **I-8** While `status === 'frozen'`, no reservation may be created and no credit consumed.

**Freeze arithmetic:** ending a freeze of *n* days moves `validUntil` forward by exactly *n* days. Nothing else changes. The freeze does not extend the entitlement's *value*, only its *window*.

Pilates credit packages have `freeze: null` — **the capability does not exist**, rather than existing with a zero budget. Attempting to freeze one is a domain error, not a policy rejection. This matters: a zero-budget freeze is a business rule that could change; a `null` freeze is a statement that the concept does not apply.

### 5.5 Admin credit adjustment (E1)

Reception and the owner may raise or lower an entitlement's remaining credits at any time: a gift, a mistake being corrected, a migration fix-up, a gesture to keep a member. This is not a policy decision — it is an **override of one**, and it is the event a member's dispute will hinge on eight months from now.

```ts
type AdjustmentReason = 'gift' | 'correction' | 'migration' | 'support'

adjustCredits({ entitlementId, delta, reason, note, actor })
  → [ entitlementAdjusted({ delta, reason, note, creditsAvailableAfter }) ]
```

Four properties, each enforced in the **domain layer and not the UI** (AD-22, AD-39):

1. **`reason` is a closed enum.** *"How many credits did we give away last quarter?"* must be a query, not a text search across free-form notes.
2. **`note` is free text and must be non-empty.** The enum names the category; only the human can name the case. A `reason` with no `note` is a shrug with a label on it.
3. **A decrease may not drive `available` below zero** (I-1). An adjustment that would is **refused**, never clamped. Clamping is how a ledger quietly stops adding up.
4. **A migration fix-up is made by the `migration` actor**, never by a human's identity (D4). *"Credits gifted this quarter"* therefore excludes import repairs for free, rather than by remembering to filter.

An adjustment increments `restored` (upward) or `revoked` (downward). **Never `granted`, never `consumed`, and never a previous entry** — I-3 holds: corrections are new ledger entries, not overwrites. `granted` records what the product gave; `consumed` records what classes took. Neither is the owner's to edit.

---

## 6. Payment — deliberately decoupled

```ts
type Payment = {
  id: PaymentId
  studioId: StudioId
  memberId: MemberId
  amount: Money                    // integer kuruş. Never a float. Ever.
  method: 'cash' | 'bank_transfer' | 'credit_card'
  installments: number | null      // Phase 1: recorded, not processed
  status: 'recorded' | 'refunded' | 'voided'
  receivedAt: Instant              // occurredAt for revenue
  recordedBy: ActorRef

  allocations: PaymentAllocation[] // ⚠ amounts, not just ids. May be empty.
  note: string | null
}

type PaymentAllocation = {
  entitlementId: EntitlementId
  amount: Money                    // how much of THIS payment went to THAT entitlement
}
```

**Payment ⟂ Entitlement.** They are linked, not identical, and the relationship is genuinely many-to-many — which is why an allocation carries an **amount**:

| Real situation | Model |
|---|---|
| One payment buys one package *(the normal case)* | 1 payment, 1 allocation |
| One card pays for mother and daughter | 1 payment, 2 allocations |
| Half now, half next week | 2 payments, 1 allocation each |
| Deposit / credit on account | 1 payment, **0 allocations** |
| Comp, staff, or promotional membership | 1 entitlement, **0 payments**, `priceAgreed = 0` |
| Package sold on account, unpaid *(OQ-10)* | 1 entitlement, 0 payments, `balanceDue > 0` |

Any model that hangs `price` on the entitlement **and calls it revenue** will be wrong within a month of real operation. `priceAgreed` is *what was owed*. Revenue is `Payment.amount`, recognised on `receivedAt`. They are different numbers that happen to agree in the common case, and the day they disagree is the day a naïve model starts lying.

### Revenue recognition — cash basis, as directed

**Money is revenue when received.** ₺4,200 paid today is ₺4,200 of revenue today, regardless of when the eight sessions are consumed.

The consequence, stated plainly so nobody is surprised later:

- *"Expected revenue this week: ₺185,000"* is a **forecast** — renewals due, packages expiring, historical conversion rates. Not a receivable.
- *"Confirmed revenue: ₺148,000"* is the sum of `Payment.amount` where `receivedAt` is in the window.
- **Unused expired credits have no financial signal.** That money was booked months ago. They are an operational and churn signal only.
- A true deferred-revenue liability — what your accountant will eventually want — is **computable on demand**, because `credit.consumed` is tracked separately from `payment.received`. It is a projection, not a schema change.

### Uncollected revenue (OQ-10 — resolved: payment is optional)

Because reception may sell a package before money changes hands, `balanceDue > 0` is a legitimate state. This buys operational realism — comp memberships, staff memberships, "half now, half Friday" — and it incurs one obligation:

> **The owner dashboard must surface uncollected balances.** *"Tahsil edilmemiş: ₺12,600 (3 paket)."*

Otherwise "sell now, collect later" quietly becomes "sell now, never collect." That is an L0 rules-engine item, and it is why this decision is not free. Reception's UI shows an explicit unpaid warning at the moment of sale.

**A member with `balanceDue > 0` is not blocked from booking.** Debt collection is a business conversation, not a domain invariant — and a system that locks a paying member out of her Tuesday class because ₺400 is outstanding will lose the member and the ₺400.

---

## 7. ClassSession and Reservation

```ts
type ClassSession = {
  id: ClassSessionId
  studioId: StudioId
  branchId: BranchId               // ⚠ branch-scoped: a class happens somewhere
  trainerId: StaffUserId
  templateId: ClassTemplateId | null   // recurring schedule source

  category: 'pilates_group' | 'fitness' | 'private'
  startsAt: Instant
  endsAt: Instant
  capacity: number                 // 8 reformers. A hard physical limit.

  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  cancellation: { reason: string; by: ActorRef; at: Instant } | null

  bookedCount: number              // ⚠ authoritative. Guarded by transaction.
  attendedCount: number            // projected, rebuildable
}
```

`bookedCount` lives **on the session document** and is written inside the booking transaction. It is not a projection. It is the thing that makes *"the last seat"* mean something, and it is read in the same transaction that writes it.

Contention is not a concern here: Firestore sustains roughly one write per second to a single document, and a class holds eight to fifteen people who do not book simultaneously. **Distributed counters would be premature** (Doc 1, §10).

```ts
type Reservation = {
  id: ReservationId
  studioId: StudioId
  branchId: BranchId
  classSessionId: ClassSessionId
  memberId: MemberId
  entitlementId: EntitlementId     // which entitlement paid for this seat

  status: ReservationStatus
  bookedAt: Instant
  bookedBy: ActorRef               // reception | member | (later) ai_agent

  resolvedAt: Instant | null
  resolvedBy: ActorRef | null
  attendanceSource: AttendanceSource | null   // ⚠ null ⇔ unresolved. See §8, AD-38.

  policyVersion: PolicyVersionRef  // ⚠ D3 — the cancellation rules AT BOOKING TIME
  creditEffect: 'held' | 'consumed' | 'released' | 'none'
}

type AttendanceSource =
  | 'trainer'          // somebody watched the class and said so
  | 'system_default'   // nobody said anything; the policy default applied
  | 'correction'       // an earlier outcome was overturned, with a reason
```

### 7.1 Reservation state machine

```
                              ┌────────────┐
                              │   booked   │  credit: held
                              └──────┬─────┘
      ┌───────────────┬──────────────┼──────────────┬───────────────────┐
      │               │              │              │                   │
 cancel ≥ window cancel < window  OBSERVED       OBSERVED        NOBODY MARKED IT
      │               │           attended       no-show      endsAt + grace passed
      │               │              │              │                   │
      ▼               ▼              ▼              ▼                   ▼
┌───────────┐ ┌──────────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────────────┐
│ cancelled │ │late_cancelled│ │ attended │ │  no_show  │ │  the policy default   │
│           │ │              │ │          │ │           │ │  resolves it to       │
│ credit:   │ │ credit:      │ │ credit:  │ │ credit:   │ │  attended | no_show   │
│ released  │ │ per policy   │ │ consumed │ │per policy │ │  credit: as that      │
│           │ │              │ │          │ │           │ │          outcome says │
│ source: — │ │ source: —    │ │ source:  │ │ source:   │ │  source:              │
│           │ │              │ │ trainer  │ │ trainer   │ │   system_default      │
└───────────┘ └──────────────┘ └──────────┘ └───────────┘ └──────────────────────┘
                                     ▲              ▲                  │
                                     └──────┬───────┴──────────────────┘
                                            │  owner/reception overturns it,
                                            │  with a reason  →  source: correction
                                     ┌──────┴───────┐
                                     │  corrected   │  compensating events only
                                     └──────────────┘

        ┌──────────────────────────────────────────┐
        │  class_cancelled   (the studio cancels)  │
        │  credit: released — always, no exception │
        └──────────────────────────────────────────┘

  Reserved for future phases, modelled but not built:
    waitlisted ──promoted──▶ booked
```

**The fifth branch is the one this studio actually walks**, hundreds of times a week. It is a *presumption*, and it emits `reservation.auto_resolved` — not `reservation.attended`. See §8.

`waitlisted` exists in the enum. Nothing produces it in Phase 1. The seam costs one enum member; retrofitting a state into a state machine with live data costs a migration.

### 7.2 The decision function

This is the only genuinely hard logic in the system, and it is a **pure function** (Doc 1, §6). No I/O. No ambient clock.

```ts
function decideCancellation(
  reservation: Reservation,
  session: ClassSession,
  entitlement: Entitlement,
  policy: CancellationPolicy,      // the version stamped on the reservation
  now: Instant,                    // injected
  actor: ActorRef,
): DomainEvent[] {

  if (session.status === 'cancelled')
    return [reservationReleased(reservation, 'class_cancelled')]   // always refund

  const hoursUntilStart = hoursBetween(now, session.startsAt)

  if (hoursUntilStart >= policy.cancellationWindowHours)           // 6h for pilates
    return [
      reservationCancelled(reservation, actor, now),
      creditReleased(entitlement, reservation.id),
    ]

  // inside the window
  const burns = policy.lateCancellationConsumesCredit               // studio-configurable
  return [
    reservationLateCancelled(reservation, actor, now),
    ...(burns ? [creditConsumed(entitlement, reservation.id, 'late_cancellation')] : []),
  ]
}
```

Note what is *not* in that function: no `Date.now()`, no Firestore, no `if (studioId === 'ours')`. The six-hour window is `policy.cancellationWindowHours`. Studio #47 sets four. **Nothing in the code knows the number six.**

### 7.3 Booking invariants

**I-9** A reservation may be created only if *all* hold:
1. `session.status === 'scheduled'` and `session.startsAt > now`
2. `session.bookedCount < session.capacity`
3. `entitlement.status === 'active'` (**not** `frozen`)
4. `session.startsAt <= entitlement.validUntil` — *you may not book a class beyond the life of the package that pays for it*
5. `entitlement.credits === null || entitlement.credits.available >= 1`
6. the member has no other `booked` reservation for the same session
7. **`entitlement.productSnapshot.category === session.category`** *(OQ-8 — resolved)*

**I-10** Creating a reservation writes three documents in **one transaction**: the reservation, `session.bookedCount += 1`, `entitlement.credits.held += 1`. Firestore requires all reads before any write. If any invariant fails, nothing is written.

Invariant 4 deserves a note: it is the one people forget, and it produces the ugliest possible customer conversation — a member whose package expires Friday holds a booking for Saturday, arrives, and is turned away by a system that sold her the seat.

Invariant 7 is the **category wall** *(OQ-8, resolved: separate products)*. An unlimited fitness membership grants unlimited **fitness**. It does not open the reformer room. This is enforced in the domain, not in the UI — a member portal, an imported reservation, and a future AI receptionist must all hit the same wall.

### 7.4 Which entitlement pays? (OQ-7 — resolved)

A member may hold several valid entitlements at once: an old package with two credits expiring on 15 July, a new one with eight expiring on 30 August. The system chooses **silently, dozens of times a week**, and must not choose wrongly in front of her.

```ts
function selectEntitlement(
  candidates: Entitlement[],        // all of the member's entitlements
  session: ClassSession,
  now: Instant,
): Entitlement | null {
  return candidates
    .filter(e => isBookable(e, session, now))   // invariants I-9.3 … I-9.5, I-9.7
    .sort(byEarliestExpiry)                     // ← the rule: validUntil ascending
    .at(0) ?? null
}
```

**Earliest-expiring-first.** The member never burns a credit she was about to lose. Reception may override the selection explicitly; the chosen `entitlementId` is written onto the `Reservation`, so *which* package paid for *which* seat is never in doubt afterwards.

Tie-break, in order: earliest `validUntil` → earliest `purchasedAt` → lowest `id` (deterministic, so the same inputs always produce the same booking — which matters for replay and for tests).

**A period entitlement is preferred over a credit entitlement only if the credit one is not bookable.** An unlimited fitness member with a leftover fitness credit package spends the *credits* first, because unlimited access has no scarcity and the credits expire.

---

## 8. Attendance (E2)

```ts
type AttendanceRecord = {
  reservationId: ReservationId
  classSessionId: ClassSessionId
  memberId: MemberId
  markedBy: ActorRef               // trainer | reception | system | owner
  markedAt: Instant                // recordedAt
  occurredAt: Instant              // the class start — what the rules engine reads
  outcome: 'attended' | 'no_show'
  source: AttendanceSource         // ⚠ trainer | system_default | correction
}
```

### The rule, as the business actually runs it

**A reservation that is never cancelled is presumed attended.** Nobody has to tick a box for the credit ledger to settle. At `session.endsAt + policy.attendance.autoResolveAfterMinutes`, a scheduled job resolves every reservation still in `booked` according to `policy.attendance.defaultOutcome` — which is `attended` for this studio.

Manual marking exists, and it is a **confirmation or an override, not the primary source.** A trainer who opens her session screen and marks the roster produces `reservation.attended` / `reservation.no_show` with `source: 'trainer'`. Reception may do the same in Phase 1, from the same screen. If nobody does, the presumption stands.

Silence is not neutral: a reservation that stays `booked` forever holds a credit forever, and I-2 breaks. The sweep is what closes the ledger.

### Why the presumption is not written down as an observation

The sweep is a `system` actor and it emits **`reservation.auto_resolved`**, carrying `{ outcome, source: 'system_default', policyRef }`. It **never** emits `reservation.attended`.

This costs one event type and one enum field, and it is not negotiable, because the alternative is unrecoverable:

- `count(type == 'reservation.attended')` must mean *"people we watched walk into a class."* If the sweep writes that type, the number is fiction and every downstream metric inherits the fiction.
- The **no-show rate becomes a structural zero.** A member who booked eleven classes and attended none looks, in the log, like a member who attended eleven.
- *"Presumed attended, but never checked in"* is the cheapest churn signal this system will ever produce — it needs only `member.checked_in` (which Phase 1 already writes) and `source == 'system_default'`. Collapse the types and the query cannot be written at all.
- **`source` cannot be backfilled.** The information was never captured. This is the same asymmetry as the actor taxonomy (D4): a seam that must be built now because it cannot be added later.

The credit consequence is identical under either modelling. That is precisely why it is tempting, and precisely why it is refused. **AD-38.**

### The default is policy, not code

```ts
policy.attendance = {
  defaultOutcome: 'attended' | 'no_show',   // this studio: 'attended'
  autoResolveAfterMinutes: number,          // grace period after session.endsAt
}
```

Studio #47 will set `no_show` — it has trainers who take a real roster and it wants the credit to survive a member who forgot to cancel. **Nothing in the code knows which studio believes what** (D3). The sweep reads the policy in force, stamps `policyRef` on the event, and a dispute in November is still explicable after the studio changes its mind in September.

### Corrections

**Every outcome is overridable by an owner or reception**, and every override is a first-class command:

```ts
correctAttendance({ reservationId, to: 'no_show', reason: 'Üye gelmedi, otomatik katıldı sayılmış' })
  → [ reservationCorrected({ from: 'attended', to: 'no_show', reason, source: 'correction' }),
      ...creditEffects ]
```

**There is no silent edit.** The original `reservation.auto_resolved` stays in the log; a correction event follows it. The audit trail then reads correctly and completely: *the policy presumed, a human disagreed, here is why, here is what changed.* Any credit movement is a compensating event — `entitlement.credit_restored` or `entitlement.credit_consumed` — never an overwrite (D5, AD-22).

The correction is also the honest answer to *"how often does the presumption get it wrong?"* — a number that only exists because the two types were kept apart.

---

## 9. Check-in and Occupancy

```ts
type CheckIn = {
  memberId: MemberId
  branchId: BranchId
  direction: 'in' | 'out'
  method: 'reception' | 'qr' | 'device'   // 'device' unused in Phase 1
  occurredAt: Instant
  recordedAt: Instant
  actor: ActorRef
}
```

Occupancy — *"there are currently 23 members inside"* — is a projection over `member.checked_in` minus `member.checked_out` since `branch.opened`.

**It will drift.** Members leave without checking out. This is a fact about pilates studios, not a bug in the software, and the model should not pretend otherwise:

- Occupancy resets to zero at `branch.closed`. It is a within-day figure.
- A member checked in for more than *N* hours is auto-checked-out by the system actor, with an event that says so.
- Reception's *"3 arriving members not checked in"* is a rule over **expected** arrivals (reservations starting soon) versus **observed** check-ins. It reasons about an event that did **not** happen — the most interesting computation on the owner's dashboard, and pure L0 rules engine, no AI (Doc 1, §11).

`branch.opened` / `branch.closed` are branch-level events with a human producer in Phase 1 and a door sensor later. **Nothing downstream will change** when the producer changes. That is D1, and this is the concrete instance of it.

> **Naming, corrected.** An earlier draft of this section wrote `studio.opened`. Wrong noun: a door belongs to a **branch**, and a studio with three branches has three opening times. Since `branchId` is a first-class dimension (AD-13), the event is `branch.opened`. See Doc 4 §3.

---

## 10. Policy

Policies are **versioned documents owned by the studio**. Never code. Never an `if`.

```ts
type Policy = {
  id: PolicyId
  studioId: StudioId
  version: number                  // monotonic. A new version is a NEW DOCUMENT.
  effectiveFrom: Instant

  booking: {
    maxDaysInAdvance: number
    maxOpenReservations: number | null
    allowMemberSelfBooking: boolean       // false in Phase 1 (no member portal)
  }
  cancellation: {
    cancellationWindowHours: number       // 6
    lateCancellationConsumesCredit: boolean
  }
  attendance: {                           // ⚠ E2, AD-38
    defaultOutcome: 'attended' | 'no_show'   // this studio: 'attended'
    autoResolveAfterMinutes: number          // grace period after session.endsAt
  }
  noShow: {
    consumesCredit: boolean               // true by default
  }
  freeze: {
    allowed: boolean                      // false for pilates credit packages
    maxDays: number
    minDaysPerFreeze: number
    maxFreezeCount: number | null
  }
}
```

**There is no `aiFences` field, deliberately.** An earlier draft carried one as a "seam" for Phase 3. It fails the phase-discipline test (Doc 6, Prime Directives): a policy is a *versioned document*, so adding a field later means publishing a new version — it never touches history. A seam that can be added later for free is not a seam; it is scope creep. When L3 arrives, `aiFences` becomes `policy.version_published` and costs nothing.

**Every credit-affecting decision stamps `policyVersion` into its event.** When the studio changes the cancellation window from six hours to four, historical late cancellations remain *correctly* late, historical disputes remain explicable, and the "late cancellation rate" chart does not silently rewrite the past.

`attendance.defaultOutcome` is the newest instance of the same discipline. This studio presumes attendance; studio #47 will presume a no-show. Nothing in the code knows which. The sweep reads the policy, stamps its version, and *"why was this credit burned in July?"* survives the studio changing its mind in September.

Policy is attached to the **product**, not to the studio globally. Pilates forbids freezing; fitness permits it. Same studio, same day.

The payoff for policy-as-data arrives in Phase 3: *"never message a member after 21:00"* will be a policy edit, not a deployment. That property comes free from the versioned-document design — it does not require building anything for it today.

---

## 11. Actors

```ts
type ActorRef =
  | { type: 'owner';        id: StaffUserId }
  | { type: 'receptionist'; id: StaffUserId }
  | { type: 'trainer';      id: StaffUserId }
  | { type: 'member';       id: MemberId }
  | { type: 'system';       id: string }        // 'attendance_auto_resolver' | 'credit_expiry_sweep'
  | { type: 'ai_agent';     id: string }        // 'receptionist_v3'  — unused in Phase 1
  | { type: 'device';       id: string }        // 'door_main'        — unused in Phase 1
  | { type: 'migration';    id: string }        // 'import_2026_07'
  | { type: 'platform_admin'; id: StaffUserId; impersonating?: StaffUserId }
```

Every command takes an `ActorRef`. Every event carries one. **No exceptions, and no borrowing** — the nightly attendance auto-resolver is `system`, not "the owner." When an AI agent first books a class in Phase 4, it books as *itself*, and the owner can see that it did.

`migration` is the actor for imported history. Every imported attendance record from the incumbent platform is attributable, distinguishable from native data, and — critically — **excludable from analytics** if the import turns out to be dirty. Which it will, somewhere.

---

## 12. Money and Time

**Money.** `Money = { amount: number /* integer kuruş */, currency: 'TRY' }`. Never a float. Never a `number` alone. ₺4,200.00 is `{ amount: 420000, currency: 'TRY' }`. Multi-currency is not a Phase 1 concern but the type carries the currency anyway, because retrofitting a currency field into a money field is a search-and-replace across every arithmetic site.

**Time.** All instants are stored in UTC. All **business** reasoning happens in the studio's timezone (`Europe/Istanbul`), which lives on the `Studio` document because studio #200 may be in Berlin.

This matters more than it looks:

- *"Today's revenue"* means the studio's calendar day, not UTC's.
- *"The 6-hour cancellation window"* is elapsed real time, timezone-independent.
- *"Freeze for 7 days"* is **calendar** days in the studio's timezone, crossing DST boundaries.

`LocalDate` and `Instant` are distinct types and the compiler must enforce it. A freeze is a `LocalDate` range. A cancellation window is an `Instant` difference. Mixing them produces off-by-one-day errors that appear twice a year and are never reproduced.

---

## 13. Private / PT Sessions (OQ-6 — resolved: sold in Phase 1)

**PT is in the imported catalogue (E4), so it is sold from day one.** It required no model change, which is the point of having modelled it.

A private session is `ClassSession` with `capacity: 1` and `category: 'private'`. A PT package is a `CreditGrant` with distinct pricing and `productSnapshot.category === 'private'`. Booking, cancellation, the category wall, the credit ledger, and the attendance sweep all apply **unchanged**.

The category wall does real work here: a PT package opens PT sessions and nothing else, and an unlimited fitness membership does not open a PT slot. That falls out of I-9.7 without a line of special-case code.

**Still out of Phase 1, and now recorded as debt** *(DEBT-008)*: trainer-specific pricing and trainer commission. PT revenue is therefore attributable to the *product*, not to the *trainer* who delivered it. That is fine until the first commission conversation, and it is not fine one minute after.

**Per-session negotiated pricing remains unmodelled.** A PT session is drawn from a package, always. If a trainer wants to quote ₺900 for one session on a Tuesday, the answer today is a one-credit PT product at ₺900 — which is honest, and which keeps `priceAgreed` meaningful.

---

## 14. Deliberately Not Modelled

Named so they are choices rather than oversights.

| Concept | Status | Cost to add later |
|---|---|---|
| Waitlist | `waitlisted` reserved in the enum; nothing produces it | Low — a promotion command and a notification |
| Makeup sessions (telafi) | Handled by **admin credit adjustment** (§5.5), which already exists — `reason: 'gift'` | Low |
| Trainer commission / payroll | Not modelled. PT ships without it *(DEBT-008)* | Medium — needs a `TrainerRate` per session type |
| Product versioning | Not modelled. `productSnapshot` freezes what was sold; the catalogue is edited in place (§5.1) | Low — nothing historical depends on it |
| Installments (taksit) | `Payment.installments` recorded, never processed | Low, until you become a payment facilitator |
| Discounts / campaigns | Not modelled. A discount today is a lower `Payment.amount` and a note. | **Medium-high** — real campaigns need a `Discount` entity, and revenue attribution gets subtle |
| Member family / corporate accounts | Not modelled | High — changes who owns an entitlement |
| Multi-currency | Type carries `currency`; nothing reads it | Low |

The one to watch is **discounts**. The moment marketing runs *"Wednesday morning 30% off"* — which is literally on the owner's target dashboard as a suggested action — you need to know that a payment of ₺2,940 was a ₺4,200 product sold at a discount, or your revenue-per-product analytics quietly lie. **Flagged for Phase 2, not Phase 1.**

---

## 15. Invariant Summary

The domain layer's test suite is this list. If these hold, the business is consistent.

| # | Invariant |
|---|---|
| I-1 | `credits.available ≥ 0`. A booking or an admin decrease that would break this is **refused, never clamped** |
| I-2 | `credits.held` equals the count of `booked` reservations against that entitlement |
| I-3 | `consumed`, `restored`, `revoked`, `expired` are monotonically non-decreasing; corrections are new entries |
| I-4 | `expired > 0` ⟹ entitlement is `expired` and unbookable |
| I-5 | `freeze.usedDays ≤ freeze.entitledDays` |
| I-6 | Freeze periods never overlap |
| I-7 | A freeze never starts in the past |
| I-8 | A frozen entitlement cannot be reserved against or consumed |
| I-9 | Booking preconditions (§7.3), **all seven** |
| I-10 | Reservation + seat count + credit hold commit in one transaction, or none do |
| I-11 | Every event carries an `ActorRef`, an `occurredAt`, and a `recordedAt` |
| I-12 | Every credit-affecting event carries the `policyVersion` it was decided under |
| I-13 | No event payload contains PII |
| I-14 | A `ClassSession` cancelled by the studio releases **every** held credit, unconditionally |
| I-15 | `entitlement.paidTotal` equals the sum of all `PaymentAllocation.amount` targeting it, excluding `refunded` / `voided` payments |
| I-16 | A payment's `amount` is ≥ the sum of its allocations. The remainder is credit on account. |
| I-17 | Entitlement selection is deterministic: earliest `validUntil`, then earliest `purchasedAt`, then lowest `id` |
| **I-18** | Every resolved reservation carries an `attendanceSource`. **The `system` actor never emits `reservation.attended` or `reservation.no_show`** — it emits `reservation.auto_resolved`. *(AD-38)* |
| **I-19** | An entitlement may not expire while `credits.held > 0`. The attendance auto-resolver runs before the expiry sweep. *(AD-26, AD-43)* |
| **I-20** | Every `entitlement.adjusted` carries a `reason` from the closed enum **and** a non-empty `note`. `granted` and `consumed` are never written by an adjustment. *(AD-39)* |
| **I-21** | Every stored `member.phone` is valid E.164, and no two active members of a studio share one. *(AD-40)* |

Twenty-one invariants. **They are the domain test suite** (Doc 5 §8, Doc 6 §6): I-1…I-10 and I-18…I-20 as property tests over generated command sequences, I-11…I-13 as golden-fixture assertions, I-21 at the validation boundary and in the migration reconciler.

---

## 16. Resolved Decisions

| # | Question | Resolution |
|---|---|---|
| **OQ-7** | Which entitlement pays when several are valid? | **Earliest-expiring-first**, deterministic tie-break, reception may override. `Reservation.entitlementId` records the choice. (§7.4) |
| **OQ-8** | Does a fitness period membership grant pilates access? | **No.** `Product.category` must equal `ClassSession.category` — the *category wall*, enforced in the domain (I-9.7). |
| **OQ-10** | May reception sell an unpaid package? | **Yes**, payment is optional. `balanceDue > 0` is legitimate. Obligation incurred: the owner dashboard **must** surface uncollected balances, and reception's UI warns at point of sale. (§6) |
| **OQ-6** | Private/PT: modelled only, or sold in week 1? | **Sold in Phase 1.** PT is in the imported catalogue (E4). No model change was needed. Trainer pricing and commission stay out. (§13, AD-45, DEBT-008) |
| **E1** | How does a credit leave the ledger, and who may move it by hand? | Booking **holds** (`available` drops immediately); in-window cancellation **releases**; resolution **consumes**. Admin may adjust either way with a closed-enum `reason` and a mandatory `note`. (§5.3, §5.5, AD-39) |
| **E2** | What happens to a reservation nobody marked? | The **policy default** resolves it — `attended` for this studio — via `reservation.auto_resolved`, `source: 'system_default'`. Manual marking is confirmation/override, never the primary source. (§8, AD-38) |
| **E4** | Is the catalogue code or data? | **Data.** Products are created, edited, deactivated, and imported. No product name or price appears in a source file. `category` stays a closed enum, because the category wall depends on it. (§5.1, AD-41) |
| **OQ-18** | Who may write the catalogue? | **`owner` + `platform_admin`.** Reception reads and sells; she does not edit the price list. Authorized in the Server Action. (§5.1, AD-46) |

## 17. Open Questions

| # | Question | Blocks |
|---|---|---|
| **OQ-9** | Auto-check-out threshold *N* hours (§9). Suggest 4h. | Phase 2 |
| **OQ-11** | *Arising from OQ-10.* When a member with `balanceDue > 0` eventually pays, reception records a `Payment` and allocates it. Should an **unallocated** payment (credit on account) auto-allocate to the oldest outstanding balance? Proposal: **no** — auto-allocation of money is the kind of helpfulness that produces accounting disputes. Reception allocates explicitly. | Reception UI |
