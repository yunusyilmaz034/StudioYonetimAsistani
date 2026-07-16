import type { Category, ProductId, ServiceId, StudioId } from '../../../shared'

// The package catalogue (Doc 2 §5.1, AD-41). A Product is a sellable template —
// what buying it grants. It is DATA: created, edited, deactivated by the owner, never
// a literal in code. `entitlement.productSnapshot` freezes what a member bought, so a
// later catalogue edit can never rewrite history.
//
// Products are never deleted — only deactivated (a deactivated product keeps paying
// the entitlements already sold from it).

export type ProductType = 'credit' | 'period'

export interface Product {
  readonly id: ProductId
  readonly studioId: StudioId
  readonly name: string
  readonly category: Category // the wall (I-9.7) — a closed enum
  readonly serviceIds: readonly ServiceId[] // finer scope; informational in Phase 1
  readonly type: ProductType
  readonly durationDays: number // validity length (credit: validForDays; period: durationDays)
  readonly creditCount: number | null // credit ⇒ N; period ⇒ null (unlimited)
  readonly priceInKurus: number // integer kuruş (non-negotiable #10)
  readonly freezeAllowanceDays: number
  // ── Package rules (Plus Phase 3). null ⇒ UNLIMITED / no limit — the safe default that preserves
  //    pre-Phase-3 behaviour (a package with no rule cancels and books without limit). A number is a
  //    counted limit, resolved against the member override at reservation time. Never enforced by an
  //    `if` in the UI; read by the reservation deciders via `resolveReservationPolicy`. ──
  readonly dailyReservationLimit: number | null // max active reservations per studio-local day; null ⇒ unlimited
  readonly cancellationAllowanceCount: number | null // free (in-window) cancellations allowed; null ⇒ unlimited
  readonly activeReservationLimit: number | null // max concurrent active/future reservations; null ⇒ unlimited
  readonly description: string
  readonly active: boolean
}
