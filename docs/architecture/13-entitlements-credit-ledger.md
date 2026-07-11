# 13 — Entitlements & the Credit Ledger

> **Status: implemented (v1.8), core only.** This document records how the credit
> ledger — the money core of Doc 2 §5 — is built in `packages/core/modules/entitlements`.
> It adds no new domain rules; it implements the ones Doc 2 §5 and Doc 4 already
> approved. Where the two disagree, **Doc 2 wins.**

## Scope of v1.8

**In:** the entitlement aggregate, the six-counter credit ledger, and every ledger
movement as a pure decision function — purchase, hold, release, consume, restore,
admin adjustment, expiry, cancel — plus the standalone use-cases (purchase, adjust,
cancel, expire) with Firestore wiring, and golden fixtures for every event.

**Out (by design):**
- **Freeze / unfreeze operations** — deferred; the arithmetic is an open question
  for the owner (DEBT-009). `status: 'frozen'` and `FreezeState` are modelled so the
  aggregate shape is stable and I-8 holds.
- **The reservation-driven wiring** — `hold`/`release`/`consume`/`restore` ship as
  tested pure deciders, but their transactional orchestration (reservation + session
  seat + credit hold in one transaction, I-10) belongs to the reservations module (v1.9).
- **Server Actions** — purchase needs a `ProductSnapshot` from the catalogue, which
  is a later module. The action layer and its authorization (below) arrive with the
  catalogue and selling UI.
- **The expiry sweep job** — the domain decider and `expireEntitlement` use-case
  exist; the scheduled Cloud Function that queries and calls them is built when
  `apps/functions` is.

## Domain model

One aggregate, two shapes, discriminated by `grant.kind` (Doc 2 §5.2):

- **Credit** entitlement — carries a `CreditLedger`; booking holds and resolution
  consumes.
- **Period** entitlement — `credits: null`; unlimited access, checked by validity
  only. A no-show records the event but burns nothing.

```
available = granted + restored − consumed − held − revoked − expired
```

Six monotonically non-decreasing counters (I-3). `available` is derived, never
stored as truth, but denormalised onto the Firestore document for reads (AD-14,
DEBT-004). The `productSnapshot` freezes what was bought at purchase, so a later
catalogue edit cannot reach backwards (Doc 2 §5.1).

## The movements

| Decider | Effect | Emits |
|---|---|---|
| `decidePurchase` | creates the aggregate | `entitlement.purchased` |
| `decideHold` | `held++`, available drops immediately (E1) | `entitlement.credit_held` |
| `decideRelease` | `held−−`, no counter moves | `entitlement.credit_released` |
| `decideConsume` | `held→consumed`; last one also `exhausted` | `entitlement.credit_consumed` (+ `entitlement.exhausted`) |
| `decideRestore` | `restored++` (consumed untouched) | `entitlement.credit_restored` |
| `decideAdjust` | `restored`/`revoked` by sign of delta | `entitlement.adjusted` |
| `decideExpire` | unused → `expired`, status `expired` | `entitlement.expired` |
| `decideCancel` | status `cancelled` | `entitlement.cancelled` |

There is **no `entitlement.credit_revoked` event** (AD-43): an admin take-back is
`entitlement.adjusted` with a negative delta. `credit_restored` survives only for
the reservation-driven correction, which always carries a `reservationId`.

## Refusals (the domain, not the UI)

`insufficient_credits` (hold/adjust below zero — I-1, never clamped) · `entitlement_not_active`
(I-8) · `not_a_credit_entitlement` · `no_held_credit` · `invalid_adjustment` (zero/non-integer
delta) · `note_required` (I-20) · `held_credits_block_expiry` (I-19) · `reason_required`
(cancel). Each maps to one Turkish message in `apps/web/lib/domain-error.ts`.

## Firestore

`/studios/{sid}/entitlements/{entitlementId}` — flat, studio-scoped. `memberId` and
`branchId` are indexed fields, never path segments. Writes are Admin-SDK only
(AD-15); the default-deny perimeter already forbids client writes. Composite indexes:
`(memberId, validUntil)` for a member's packages and earliest-expiring selection, and
`(status, validUntil)` for the expiry sweep.

## Authorization (documented for the action layer, v1.9+)

| Operation | Who |
|---|---|
| Purchase (sell) | owner · receptionist · platform_admin |
| Admin adjustment | owner · receptionist · platform_admin (AD-39: reason + note) |
| Cancel | owner · platform_admin |
| Expire | `system` actor only (scheduled sweep) |

Enforced in the Server Action via `requireTenantContext([...])` (AD-46), not in
Firestore rules — no client writes state.

## Invariants owned

I-1 (available ≥ 0, refused not clamped) · I-3 (monotonic counters) · I-4 (expired ⟹
unbookable) · I-12 (every credit-affecting event carries its `policyVersion`) · I-19
(no expiry while held) · I-20 (adjustment reason + note). I-2/I-9/I-10/I-17 are
reservation-side (v1.9). I-5…I-8 (freeze) are modelled but unenforced until the
freeze operations land (DEBT-009).

## Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| **AD-53** | The **entitlements module owns the ledger arithmetic** (hold/release/consume/restore as pure deciders); the **reservations module owns the orchestration** that calls them inside the booking transaction (I-10). | Putting the ledger math in reservations — splits the ledger's ownership and duplicates the invariants. |
| **AD-54** | **Freeze operations deferred** until the owner resolves the freeze-duration and over-budget semantics (DEBT-009); the *shape* (`FreezeState`, `status: 'frozen'`) ships now so it is retrofit-free. | Guessing the arithmetic now — an unrecoverable choice baked into events. |
| **AD-64** *(v1.14)* | The catalogue is the **`catalog` module**: `Product` CRUD with `product.created` + generic `product.updated` (deactivation is an `active` field change), never deleted. Authz owner + platform_admin (AD-46). | A hardcoded price list, or a separate deactivate/reactivate event per the scheduling pattern — the former violates AD-41, the latter is more events than a generic update needs. |
| **AD-65** *(v1.14)* | **Manual payment is a record-only embedded value** (`entitlement.manualPayment` + `entitlement.payment_recorded`), NOT a payments aggregate or allocation engine — a clean seam a future `payments` module migrates from. Subscription edits are the generic `entitlement.amended` (dates/price/payment, before+after, reason) + `entitlement.reactivated`; **credit edits reuse `entitlement.adjusted`** (no new arithmetic). | A full payments aggregate with allocations now — commerce infrastructure the milestone explicitly excludes; or a new event per editable field — needless event sprawl. |

## v1.14 — Manual Subscription Assignment

Owner/reception assign a package to a member from the Member workspace and record a
manual payment — **not** a selling or payments system. `assignSubscription` is atomic:
`entitlement.purchased`, then (if the credit is overridden) `entitlement.adjusted`,
then (if money was collected) `entitlement.payment_recorded` — one save, one
`correlationId`. `paidTotal` mirrors `manualPayment.collectedAmount`; `balanceDue =
priceAgreed − collected` (0 collected = comp / on account, legal per Doc 2 §6, OQ-10).

Payment method is a manual enum only — `cash | credit_card | bank_transfer`. No POS,
gateway, allocation, refund, or instalment (a future `payments` milestone). Every
manual edit carries a mandatory `reason` and its before/after value in the event.
