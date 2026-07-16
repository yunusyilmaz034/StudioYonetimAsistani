# `catalog` — the package catalogue

## Purpose

The sellable **package catalogue** (Doc 2 §5.1, AD-41): the templates an owner creates
and a member is assigned. **The catalogue is data** — no product name, price, or credit
count ever appears in a source file. `entitlement.productSnapshot` freezes what a member
bought, so a later catalogue edit can never rewrite history.

A `Product` is a **credit** package (`creditCount` credits, valid `durationDays`) or a
**period** package (unlimited for `durationDays`). It also carries `priceInKurus`
(integer kuruş, non-negotiable #10), a `freezeAllowanceDays` budget, and the Package
Rules 2.0 fields `dailyReservationLimit` / `cancellationAllowanceCount` /
`activeReservationLimit` (each `null` ⇒ unlimited). Since Plus Phase 3 these are **enforced**
by the reservation deciders via `resolveReservationPolicy` (studio → package → member override);
they are frozen onto the entitlement's product snapshot at purchase, so a later catalogue edit
never changes a rule a member already bought.

## Public API (`index.ts`)

- **Types** — `Product`, `ProductType`.
- **Use-cases** — `createProduct`, `updateProduct` (load → decide → save).
- **Events** — `product.created` (name, category, grant, price) · `product.updated`
  (generic `changedFields`). Deactivation is an `active` field change — **products are
  never deleted, only deactivated** (a deactivated product keeps paying the entitlements
  already sold from it). *(AD-64)*
- **Infrastructure** — `FirestoreCatalogRepository` (Admin SDK only, AD-15).

## Authorization

Catalogue writes are **owner + platform_admin** (AD-46), enforced in the Server Action;
reception reads the catalogue (to sell) but does not edit the price list. `category`
stays a closed enum — the category wall (I-9.7) depends on it.

## What it does not own

Assigning a package to a member, credits, and the manual payment are the **entitlements**
module's (Doc 13, v1.14). This module only defines what is for sale.
