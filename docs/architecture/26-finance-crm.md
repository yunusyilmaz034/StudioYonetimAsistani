# 26 — Finance & CRM (v1.24)

**Status:** **APPROVED and BUILT** (owner, 2026-07-13). All six decisions are locked — §13.
**Date:** 2026-07-13
**Milestone:** v1.24 — the studio's financial centre, and the relationship that precedes it

---

## 0. The honest starting point

There is **no payments module**. Money lives on the entitlement:

```ts
priceAgreed:   Money            // what was agreed
paidTotal:     Money            // denormalised
manualPayment: ManualPayment | null   // ONE record-only payment (v1.14 seam)
```

Read that last line again: **one**. Today the system cannot represent a member who pays half now and
half next month — the thing the owner listed as *"kısmi ödeme"* is not a missing screen, it is a
missing model. It cannot represent two payments, a refund, a payment that pays *two* packages, a
gift card, or a discount that is anything other than a lower agreed price.

This is not a criticism of v1.14; it was a deliberate, documented seam that let the studio operate.
**v1.24 is where the seam closes**, and the shape of the closure is the whole architecture.

---

## 1. The one architectural claim

> **Money gets its own ledger, and the entitlement stops holding money.**

Every requirement on the owner's list — cari hesap, borç/alacak, kısmi ödeme, ödeme planı, iade,
kupon, gift card, gün sonu, kasa, personel primi — is the same shape: **a movement of value between
two parties, at a moment, for a reason, attributable to a person.** One model answers all of them.
Nineteen screens over nineteen fields answers none of them, and each new one makes the next harder.

The credit ledger (Doc 2) is the proof this works: `granted / held / consumed / released / expired`
is not a set of booleans, it is an **append-only arithmetic** whose invariant (`available = …`) can
be re-derived from zero at any time. The money ledger is the same idea with a different unit.

### 1.1 The spine

```
Sale (Satış)            what the studio is OWED, and for what
  ├─ lines[]            each line grants something (a package, a PT block, a gift card)
  ├─ discounts[]        coupon · campaign · referral · manual — each with a reason and an actor
  ├─ soldBy             the STAFF PRINCIPAL who sold it   ← attribution, decided at write time
  └─ total              net of discounts, integer kuruş

Payment (Tahsilat)      what actually MOVED, and through what
  ├─ method             cash · bank_transfer · card · pos · online(provider)
  ├─ drawer             which kasa it landed in (cash/pos only)
  ├─ receivedAt         the CASH-BASIS date — revenue is recognised here
  └─ takenBy            the staff principal who took it

Allocation              WHICH payment pays WHICH sale, and how much
  └─ many-to-many, with amounts   (a payment may settle two sales; a sale may take five payments)

Refund                  money OUT — a compensating movement, never a deleted payment
```

**Cari hesap** is then not a stored number but a **derivation**:

```
memberBalance = Σ sales.total − Σ allocations.amount − Σ creditNotes + Σ refunds
```

…which is exactly how `available` works for credits, and it means the balance can never be *wrong* —
only the movements can, and every one of them is an event with an actor and a reason.

### 1.2 What must NOT be built

- **No stored balance as the source of truth.** A denormalised `balance` for querying is fine (same
  register as `credits.available`, written in the same transaction). A balance that is *incremented*
  and never re-derivable is how a finance module starts lying quietly.
- **No float. Ever.** Money is an integer in kuruş (#10). A percentage discount computes to an
  integer *at the moment of sale* and is stored as an amount, not as a percentage to be re-applied
  later — otherwise the same 15 % becomes a different number in 2027 because a rounding rule moved.
- **No payment that mutates.** A mistaken payment is voided by a compensating event with a reason
  (#9), never edited. The gün sonu depends on this being true.

---

## 2. Attribution — the one thing that cannot be retrofitted

**`soldBy` and `takenBy` must be captured from the first sale, even though "prim altyapısı" is not
being built in v1.24.**

This is the actor-taxonomy argument again (Doc 1's AI seam, and the reason the event envelope has
carried `actor` since v1.0): commission, staff-based sales reports and pipeline conversion are all
questions of *who*. If the sale does not record who sold it, **no amount of later engineering
recovers it** — the information was never written down. The screen for commissions can wait; the
field cannot.

The same reasoning applies to `Lead.source` (§8): a lead whose origin was not recorded can never be
attributed to the campaign that produced it.

**Build the seam now. Build the commission engine when the owner has a commission policy.**

---

## 3. The aggregates

| Aggregate | Owns | Notes |
|---|---|---|
| **Sale** | lines, discounts, total, `soldBy`, status (`open` · `settled` · `cancelled`) | Cancelling a sale is an event, never a delete. |
| **Payment** | amount, method, `receivedAt`, `takenBy`, drawer, provider ref | Immutable. Voided by `payment.voided`. |
| **Allocation** | (paymentId, saleId, amount) | Its own small aggregate: it is the join that makes partial payment expressible. |
| **Refund** | amount, method, reason, links to payment(s) | Money out. |
| **CashDrawer (Kasa)** | branch, currency, open/close shifts | `drawer.opened` → movements → `drawer.closed` with a **counted** amount. |
| **DrawerCount (Gün sonu)** | expected vs counted, discrepancy, who counted | A discrepancy is **recorded, never silently corrected** — that record is the entire point of a day-end. |
| **PaymentPlan (Ödeme planı)** | instalments: due date + amount + status | An instalment is a *promise*, not a payment. It never touches the ledger until money moves. |
| **Coupon / Campaign / GiftCard** | code, value, validity, redemption ledger | A gift card is a **liability**: sold as a sale, spent as a discount. Its balance is a ledger, like credits. |
| **Lead** | contact, source, stage, owner (staff), lost reason | The CRM spine. |
| **Offer (Teklif)** | lines, price, validity, status (`sent` · `accepted` · `rejected` · `expired`) | Accepting an offer **produces a Sale** — that is the funnel's only join. |
| **CrmNote / Interaction** | call, WhatsApp, note, meeting — kind + at + by + text | One shape for every interaction; WhatsApp is a *kind*, not a module. |

**Entitlement keeps `productSnapshot` and loses money.** After v1.24 it carries no `priceAgreed`, no
`paidTotal`, no `manualPayment` — those become the Sale's. What granted the entitlement is a **sale
line**, and the link is `entitlement.saleId`.

---

## 4. Events (indicative names; the catalogue is decided at implementation)

```
sale.created · sale.line_added · sale.discount_applied · sale.cancelled · sale.settled
payment.received · payment.voided · payment.refunded
allocation.applied · allocation.reversed
drawer.opened · drawer.counted · drawer.closed · drawer.discrepancy_recorded
plan.created · plan.instalment_due · plan.instalment_paid · plan.defaulted
coupon.issued · coupon.redeemed · giftcard.issued · giftcard.redeemed · giftcard.expired
lead.captured · lead.stage_changed · lead.assigned · lead.lost · lead.converted
offer.created · offer.sent · offer.accepted · offer.rejected · offer.expired
interaction.logged
member.churned            ← the churn reason, as a closed enum + free text
```

**Every one of these carries `actor`, `occurredAt`/`recordedAt`, `correlationId` (= OperationId,
OP-2) and, where it changes value, the post-state of the number it changed (AD-19).** None of them
carries PII (#6): a lead's phone lives in `/leads/{id}`, not in `lead.captured`.

---

## 5. The legacy seam — and the decision it forces (OQ-1)

Existing entitlements carry `priceAgreed` + `manualPayment`. Six months of a live studio will carry
more. When the Sale/Payment ledger lands, **there are two sources of truth for the same money**, and
that is intolerable — a finance module that disagrees with itself is worse than no finance module.

Three ways to close it:

**(a) Migrate — generate historical Sales and Payments from the existing entitlements.**
A one-off script emits `sale.created` + `payment.received` with `source: 'migration'`, `actor: system`,
and `occurredAt` = the original purchase/payment instant. The entitlement's money fields are then
dropped. *Pro:* one model, one query, forever. *Con:* it is a **real migration** (the owner has said
"no migration" for three milestones — this is the first one where I would ask for it), and it must be
dry-run and reconciled (`pnpm migrate:reconcile` already exists for exactly this shape of problem).

**(b) Read-side union — the finance module reads legacy entitlement fields for pre-cutover packages
and the new ledger after.** *Pro:* no migration, nothing rewritten. *Con:* every query, every report,
every screen carries an `if (legacy)` **forever**, and the day-end/cari-hesap arithmetic has to be
implemented twice. This is the cheap decision that gets more expensive every month.

**(c) Cut over at a date and leave history alone** — old packages keep their v1.14 fields, are
readable in the member's finance history, and are simply not part of the new ledger's arithmetic.
*Pro:* cheapest, honest. *Con:* the cari hesap of a member who bought before cutover is incomplete,
and the owner will find that out at the worst possible moment.

**My recommendation: (a), and to do it during v1.26 Migration & Cutover** — the milestone that
already owns "import the old system, reconcile it, cut over". The finance ledger ships in v1.24 and
runs **alongside** the legacy fields for the small window between the two; the migration that folds
history into it is one of v1.26's jobs, executed once, with the reconciliation tooling that milestone
builds anyway. *Nothing is thrown away, nothing is duplicated forever, and the owner does not have to
approve a migration in the middle of a feature milestone.*

---

## 6. Discounts, coupons, gift cards — three different things that look alike

- **Discount** — reduces a sale's total *at the moment of sale*. Stored as an **amount** (kuruş) plus
  the *reason* it was given (`campaign` · `coupon` · `referral` · `manual`), the actor who gave it,
  and, when a campaign or coupon produced it, that entity's id. A manual discount **requires a
  reason** (AD-39's rule again — a discount with no reason is an unexplained hole in the revenue).
- **Coupon / Campaign** — the *rule* that produces a discount. Data, never code (AD-41): a coupon is
  a document with a code, a value, a validity window and usage limits. **Nothing in the source file
  knows the number fifteen.**
- **Gift card** — a **liability**, not a discount. It is *sold* (a sale, money in) and later *spent*
  (a payment method whose source is the card's balance). Its balance is an append-only ledger with an
  invariant: `giftcard.remaining = issued − redeemed − expired ≥ 0`. Selling a gift card and treating
  it as revenue on the day it is *spent* is a real accounting choice — and it is OQ-3.
- **Hediye ders / referans indirimi** — both are discounts with a reason and a link (the referring
  member's id). No new mechanism; that is the point of having one.

---

## 7. Cash drawers and gün sonu

A **kasa** is a stateful thing in the real world, so it is a real aggregate: opened by a person,
closed by a person, with every movement attributable.

```
drawer.opened   (opening float, by whom)
  → payment.received (method: cash | pos) increments the drawer's expected balance
  → refund / payout decrements it
drawer.counted  (what the human actually counted)
drawer.closed   (expected vs counted; the difference is a RECORDED FACT)
```

**The discrepancy is never silently absorbed.** `drawer.discrepancy_recorded` carries the amount and
a mandatory note. A day-end that quietly makes the numbers agree is not a control, it is a cover-up —
and the studio's owner is precisely the person that control exists for.

**Card/POS payments** land in a POS drawer, not the cash drawer, because they settle to the bank on a
different day. Bank reconciliation is **out of scope** for v1.24 (§11), but the model must not make it
impossible: hence `method` + `providerRef` on every payment.

---

## 8. CRM — the part that is not money yet

The funnel is the same append-only story, one step earlier:

```
lead.captured (source: instagram | walk_in | referral | google | phone | other)
  → interaction.logged ×n   (call · WhatsApp · note · trial class)
  → offer.created → offer.sent → offer.accepted → SALE
                                → offer.rejected (with a reason)
  → lead.lost (closed-enum reason + free text)
```

**Churn is the same event, at the other end of the relationship:** `member.churned` with a
closed-enum reason (`price` · `schedule` · `moved_away` · `injury` · `dissatisfied` · `competitor` ·
`unknown`) and free text. The enum is what makes churn *analysable*; the free text is what makes it
*true*. Both, always.

**Churn analysis is a read model** (v1.23's machinery, unchanged): the signals already exist —
expiring entitlements, falling attendance, a package that ran out and was not renewed, check-ins that
stopped. v1.24 adds the *reason*; the analysis reads it. **No new write path.**

**WhatsApp** is an `interaction.kind`, and nothing more, until v1.25 Notification Center gives it a
transport. Building the transport here would duplicate v1.25 badly.

---

## 9. Payment providers (POS, İyzico, online) — a PORT, not an integration

```ts
interface PaymentProvider {          // the port
  charge(amount: Money, ref: PaymentIntent): Promise<ProviderResult>
  refund(providerRef: string, amount: Money): Promise<ProviderResult>
}
```

v1.24 ships **the port, the `online` method, the `providerRef` field, and a `manual` adapter**. It
does **not** ship an İyzico integration: that is a contract, a merchant account, a webhook endpoint,
a PCI conversation and a reconciliation story — a milestone, not a feature. The seam costs one
interface today and saves a rewrite later. *(Same pattern as `HolidayProvider` in v1.22, which is now
paying for itself.)*

**A webhook from a payment provider is an untrusted input.** When it lands (v1.25+), it will verify a
signature and write a `/commands` document — it will never write state directly. Deciding that now
costs nothing and prevents the single most common finance-integration security failure.

---

## 10. What this does to the dashboard (v1.23)

The daily projection currently folds `entitlement.purchased.priceAgreed` (satış) and
`entitlement.payment_recorded.collectedAmount` (tahsilat). After v1.24 those numbers come from
`sale.created.total` and `payment.received.amount`.

**No double counting**, because a given sale emits *either* the legacy pair *or* the new pair, never
both. The projector maps both families; `pnpm projections:rebuild` folds the whole log — old and new
— into the same counters. The dashboard needs **no change** beyond the projector's new cases. *This
is the dividend of having built the projection as a pure fold over events.*

---

## 11. Phasing — what ships in v1.24, and what the architecture merely makes possible

**v1.24 ships (the spine, and it must be whole to be correct):**
Sale · Payment · Allocation · Refund/void · member cari hesap & finance history · partial payments ·
payment plans (instalment records + due dates) · cash drawers & gün sonu · discounts, coupons,
campaigns, gift cards · staff attribution (`soldBy`/`takenBy`) · pending payments · upcoming
collections · CRM: leads, pipeline, interactions, offers, lost/churn reasons · the finance dashboard
widgets (they slot into the v1.23 registry — no new dashboard).

**v1.24 designs but does not build:** commission calculation (needs a policy the owner does not yet
have) · İyzico/POS integration (a milestone) · WhatsApp transport (v1.25) · automatic reminders
(v1.25) · bank reconciliation · invoicing/e-arşiv (a legal project, not a feature).

**If the milestone must be split**, the seam is clean: **v1.24-A = the money spine**, **v1.24-B = the
CRM funnel**. They share the `Sale` (an accepted offer becomes one) and nothing else.

---

## 12. New invariants (proposed)

- **I-31 — A payment is never mutated.** A mistake is a `payment.voided` + a new payment. The gün
  sonu is only trustworthy if this holds.
- **I-32 — `Σ allocations(payment) ≤ payment.amount`.** A payment cannot pay more than it is worth.
- **I-33 — `sale.balanceDue ≥ 0`.** An over-payment creates **member credit** (an explicit balance),
  never a negative sale.
- **I-34 — A discount is an amount, stamped at sale time.** Never a percentage re-evaluated later.
- **I-35 — `giftcard.remaining ≥ 0`**, and a redemption that would go below zero is **refused, never
  clamped** (AD-39's rule for credits, applied to money).
- **I-36 — Every money movement carries an actor and, when it is discretionary (discount, void,
  refund, discrepancy), a mandatory reason.**

---

## 13. Open questions — the owner's call

**OQ-1 — The legacy money seam.** Migrate (a), read-side union (b), or cut over and leave history (c)?
*Recommendation: (a), executed in v1.26 Migration & Cutover, with the ledger shipping in v1.24.*

**OQ-2 — Is revenue recognised on the sale or on the payment?**
The dashboard already shows both, and the owner defined them (D-1, v1.23). But the *accounting* basis
of the day-end and the staff commission must pick one. *Recommendation: **cash basis** — gün sonu and
prim follow the money that actually arrived (`payment.received.receivedAt`), while "satış" stays the
commercial figure. This matches how a Turkish studio is actually run and taxed.*

**OQ-3 — A gift card sold in December and spent in March: revenue in which month?**
*Recommendation: revenue when **spent** (it is a liability until then). The card's *sale* still shows
as cash in December — which is why the drawer and the revenue figure are two different numbers, and
why conflating them would misstate both.*

**OQ-4 — Who may give a discount, and is there a ceiling?** Reception giving 40 % is either a
kindness or a leak, and only the owner knows which. *Recommendation: a studio-settings ceiling
(data, not code); above it, owner-only. Every discount carries a reason regardless.*

**OQ-5 — One kasa or one per branch/shift?** *Recommendation: per branch, with shifts — it is the
only shape that survives a second branch, and it costs nothing today.*

**OQ-6 — Is a Lead a Member?** Two options: a lead is a lightweight record that *converts* into a
member (a new aggregate), or every lead is a `member` with `status: 'lead'`. *Recommendation: a
separate `Lead` aggregate. A lead has no entitlements, no reservations, no portal login and no
KVKK-consent story — merging them means every member query starts filtering, forever.*

---

## 13.1 As built

- **The spine shipped whole:** Sale · Payment · Allocation · Refund/void · cari hesap · partial
  payment · payment plans · kasa & gün sonu · discounts, coupons, gift cards · staff attribution ·
  pending payments · CRM (leads, pipeline, interactions, offers, lost/churn reasons).
- **The legacy seam runs alongside**, exactly as decided: the entitlement's v1.14 money fields are
  untouched, the new ledger is authoritative for everything sold from now on, and the projector maps
  BOTH families so no figure is double-counted. The migration that folds history into the ledger is
  v1.26's job (owner, decision 1).
- **`discountCeilingPercent`** joined studio settings (data, never a literal); above it, only the
  owner may approve.
- **Not built, by design:** commission calculation, İyzico/POS integration, WhatsApp transport,
  automatic reminders, bank reconciliation, e-arşiv. Every one has a seam and none has a screen.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Two sources of truth for money during the transition | OQ-1 decided explicitly, with a dated cutover; `migrate:reconcile` proves the totals |
| A stored balance drifts from its movements | The balance is **derived**; the denormalised copy is written in the same transaction and has a rebuild path (Doc 3 §6) |
| The milestone sprawls (39 bullet points) | §11's phasing: the spine ships whole; commissions, İyzico, WhatsApp and reminders are *seams*, not features |
| A discount becomes a way to lose money quietly | Reason mandatory (I-36), ceiling in settings (OQ-4), and every discount lands in the Audit Log |
| Finance screens grow their own private queries | The v1.23 read layer stands: bounded queries, one shared range vocabulary, exports as `ExportableTable` |
