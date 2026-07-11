# `entitlements` — the credit ledger

## Purpose

What a member **owns**: a purchased package, its validity window, and — for credit
products — a six-counter ledger that makes *"how many credits does she have, and
why"* answerable at any moment. This is the money core (Doc 2 §5). Reservations
(v1.9) sit on top of it; payments (later) allocate against it.

**Product vs. Entitlement.** A `Product` is the catalogue item (data, AD-41). An
`Entitlement` is one member's instance of buying it, with a `productSnapshot`
frozen at purchase so a later price edit can never rewrite what she bought. This
module never names a product, price, or credit count — the caller supplies the
snapshot.

## Public API (`index.ts`)

- **Types** — `Entitlement`, `CreditLedger`, `Grant` (`CreditGrant | PeriodGrant`),
  `ProductSnapshot`, `FreezeState`, `AdjustmentReason`, `available(ledger)`.
- **Pure deciders** (`domain/decide.ts`) — `decidePurchase`, `decideHold`,
  `decideRelease`, `decideConsume`, `decideRestore`, `decideAdjust`, `decideExpire`,
  `decideCancel`. Signature: `(ctx, entitlement, …) → Result<LedgerOutcome>` where
  `LedgerOutcome = { next, events }`. No I/O, no clock, no randomness.
- **Use-cases** (`application/`) — `purchaseEntitlement`, `adjustCredits`,
  `cancelEntitlement`, `expireEntitlement`; and v1.14 **manual subscription**:
  `assignSubscription` (atomic purchase + optional adjust + optional payment),
  `amendEntitlement` (generic edit), `reactivateEntitlement`. Load → decide → save.
  `hold/release/consume/restore` have **no** standalone use-case: they are driven by
  reservations and wired transactionally in v1.9.
- **Manual payment (v1.14, AD-65)** — `manualPayment` is a record-only embedded value
  (collectedAmount · method `cash|credit_card|bank_transfer` · note · recordedAt), a
  clean seam for a future `payments` module. `entitlement.payment_recorded` is the
  event; `entitlement.amended` (generic, before+after, reason) covers date/price/payment
  edits; `entitlement.reactivated` reverses a cancel. Credit edits reuse
  `entitlement.adjusted`. **No** payments aggregate or allocation engine here.
- **Infrastructure** — `FirestoreEntitlementRepository` (Admin SDK only, AD-15).

## The ledger (Doc 2 §5.3)

```
available = granted + restored − consumed − held − revoked − expired
```

Six counters, all monotonically non-decreasing (I-3). Booking **holds** (available
drops immediately, E1); an in-window cancel **releases** (held−−, no counter moves);
a resolution **consumes** (held→consumed); a correction **restores** (restored++,
consumed untouched). Admin **adjust** moves `restored`/`revoked` by the sign of the
delta — never `granted`, never `consumed` (AD-43: there is no `credit_revoked`
event).

## Invariants this module owns

- **I-1** `available ≥ 0` — a hold or a decrease that would break it is **refused,
  never clamped**.
- **I-3** `consumed`, `restored`, `revoked`, `expired` never decrease; corrections
  are new entries.
- **I-4** `expired > 0` ⟹ status `expired`, unbookable.
- **I-19** an entitlement may not expire while `held > 0`.
- **I-20** every adjustment carries a closed-enum `reason` **and** a non-empty
  `note`; `granted`/`consumed` are never written by one.
- **I-12** every credit-affecting event carries the `policyVersion` it was decided
  under (on the envelope `policyRef`).

## Deferred (not in this module yet)

- **Freeze / unfreeze operations.** `status: 'frozen'` and `FreezeState` are modelled
  (so I-8 holds and reservations can refuse a frozen entitlement), but the freeze
  *arithmetic* is an open question for the owner (see `docs/DEBT.md`).
- **`selectEntitlement` / booking preconditions (I-9, I-10)** — reservation-side, v1.9.
