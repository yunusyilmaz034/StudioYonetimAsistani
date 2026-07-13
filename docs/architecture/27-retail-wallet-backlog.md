# 27 — Retail, Wallet & Product Sales (v1.27) — **architecture backlog**

**Status:** backlog — accepted onto the roadmap (owner, 2026-07-13). **No code. No schema. Not yet
designed in detail.** This is the brief the architecture will be written against when the milestone
opens, plus the one thing that is already decided because v1.24 decided it.

---

## 1. The binding constraint (owner, and I agree without reservation)

> **The wallet is not a second accounting system. It is a new PAYMENT METHOD and a new MOVEMENT
> SOURCE on the finance ledger that shipped in v1.24.**

```
Sale  →  Payment(method: 'wallet')  →  Allocation  →  RetailOrder
```

Every retail purchase is an ordinary sale, settled by an ordinary payment, allocated by an ordinary
allocation. Nothing about `saleBalanceDue`, `memberBalance` or the gün sonu changes. The wallet adds
**one method** and **one liability ledger** — and that is the whole integration.

**A parallel wallet accounting system is the single failure this milestone must not commit.** The
moment the wallet has its own sales, its own refunds and its own balance arithmetic, the studio has
two sets of books, and the day they disagree — and they will — nobody can say which is right.

---

## 2. What the v1.24 spine already carries

The finance module was built for this without knowing it, which is the test of whether it was built
right:

| Retail needs | v1.24 already has |
|---|---|
| A wallet balance that cannot be hand-edited | The ledger pattern: `available = granted + … − …`, derived, never stored as truth |
| A payment method that is not cash | `PaymentMethod` is a closed enum; `'wallet'` joins `'gift_card'`, which is already a **liability spent as a payment** |
| Money in from a virtual POS | `PaymentProvider` **port** + `providerRef` on every payment (Doc 26 §9) |
| A price that must not change history | `SaleLine` is a **snapshot** — description, quantity, unit price, frozen at sale time (I-34's sibling) |
| A refund that is not a deletion | `payment.refunded` / `payment.voided` — compensating movements with a mandatory reason (I-31, I-36) |
| An owner adjusting a balance | The AD-39 shape: closed-enum reason **+** mandatory note, refused below zero, never clamped |
| Every movement visible | The Activity Engine: one presenter, one OperationId, one audit log |

**A gift card is already exactly this.** It is issued (money in), spent (`method: 'gift_card'`), has
an append-only balance, and refuses to go below zero (I-35). **The member wallet is a gift card with
the member's name on it and more ways to load it.** If the design of the wallet ever needs a
mechanism the gift card did not, that is a signal to look again — not to build a new mechanism.

---

## 3. The wallet

```ts
// The balance is DERIVED, always. Same rule as credits, same rule as the cari hesap.
walletBalance = Σ topups + Σ adjustments(+) + Σ refundsToWallet
              − Σ purchases − Σ adjustments(−) − Σ voidedTopups
```

Events (owner's names, kept): `wallet.topup` · `wallet.purchase` · `wallet.refund` ·
`wallet.adjustment` · `wallet.voided`. Append-only, every one with an actor, and — for
`wallet.adjustment` — a **closed-enum reason plus a mandatory note**, refused below zero.

**New invariant, proposed: I-37 — a wallet is never spent below zero. Refused, never clamped.**
(The credit ledger's rule and the gift card's rule, for the third time. That it keeps being the same
rule is the point.)

**Top-up channels:** virtual POS · cash · bank transfer · an owner's manual, reasoned top-up. Each is
an ordinary `Payment` into the wallet's liability, so the kasa and the gün sonu see cash top-ups
exactly as they see any other cash.

---

## 4. The virtual POS — the security decision, made now

**The client's response is never trusted.** A browser saying *"the payment succeeded"* is a claim by
the party with the most to gain from it.

```
member → provider (3-D Secure) → provider WEBHOOK → verify signature
                                                  → write /commands/{ulid}   ← the ONLY client-
                                                  → trigger applies it          writable collection
                                                  → wallet.topup event
```

Three properties, and each prevents a known way this goes wrong:

1. **Signature verification before anything is written.** An unverified webhook is an unauthenticated
   request to mint money.
2. **Idempotent by the provider's payment id.** Providers retry. A retried webhook that tops up twice
   is a free balance — the `/commands` collection already has exactly this property (the command's
   ULID is its idempotency key, and the trigger refuses a second apply).
3. **The webhook writes a COMMAND, never state.** It is untrusted input arriving at a public
   endpoint; it goes through the same door as an offline check-in, and the domain decides.

This is the one part of the milestone that must not be simplified under time pressure.

---

## 5. Retail catalogue, stock and variants

- **The catalogue is data** (AD-41, again): name, category, description, image, price, active flag,
  optional stock, optional variants (size · colour · measure). **No product name or price in a
  source file, ever.**
- **A price change never touches a past sale.** The `SaleLine` snapshot already guarantees this — it
  is the same reason `productSnapshot` exists on an entitlement.
- **Stock is optional, per product.** Water and coffee sell without it; leggings and towels track it,
  with variants.
- **Default: a tracked product does not go below zero** — refused, never clamped, with the policy
  itself as **data** (product or studio setting), never an `if`.
- **Stock is a ledger too** (`stock.received` · `stock.sold` · `stock.adjusted` · `stock.counted`),
  because "why do we have three towels when the system says five" is the same question as a kasa
  discrepancy, and it deserves the same honest answer.

---

## 6. Delivery — deliberately weak, deliberately explicit

The studio is boutique and trust-based: **delivery confirmation is NOT a condition of the financial
transaction** in v1 (owner). The order carries a status (`purchased` · `ready` · `delivered` ·
`cancelled`) and the member takes her towel from the shelf.

This is a *business* decision, and it is the right one — but it is written down here so that the day
someone asks "did she actually get it?", the answer is *"we chose not to record that, and here is
when we chose it"*, rather than a silence. Delivery verification is an **opt-in** feature later.

---

## 7. Security (all of it already exists as a rule; none of it is new)

- A member **reads her own wallet and orders, and nothing else** — the v1.21 member perimeter.
- A member **never writes a balance.** She writes nothing but a command; the server decides.
- **The price is never accepted from the client.** The server reads the current product snapshot and
  prices the sale itself. (A client-supplied price is a discount field with no reason attached.)
- The **full audit is owner-only**, as it has been since v1.22.

---

## 8. Where it sits in the roadmap, and why the owner's placement is right

**v1.27, after Production Hardening (v1.26) — I agree, and the reason is stronger than convenience:**
this is the first milestone that takes **real money from a customer over the internet**. Card data,
webhooks, retries, refunds, and a balance the member believes in. Shipping that before there is CI, an
integration test suite, monitoring and a backup story would be indefensible — the stakes are not "a
screen is wrong", they are "a member's money is wrong".

It also lands **after Notification Center (v1.25)**, which it needs: a top-up with no receipt and a
purchase with no confirmation is a support ticket by design.

**Training & Progress moves to v1.28**, and AI to v1.29 — AI still reads everything, and it still
benefits from being last.

---

## 9. The questions the owner will answer when this opens

1. **Is the wallet balance refundable to cash?** (If yes, it is stored value with consumer-protection
   implications; if no, say so at top-up time, in the interface, in Turkish.)
2. **Does the wallet expire?** (A balance that expires is revenue; a balance that never expires is a
   liability that grows forever. Both are legitimate; they are different businesses.)
3. **KDV / receipt.** A physical product sale has tax consequences that a class booking does not. This
   is a legal question, and it may make **e-arşiv invoicing** a prerequisite rather than a later item.
4. **Who prices a variant?** One price per product, or per variant?
5. **May reception sell retail from the desk**, or only the member from the portal? (Almost certainly
   both — but the drawer and the attribution differ.)
