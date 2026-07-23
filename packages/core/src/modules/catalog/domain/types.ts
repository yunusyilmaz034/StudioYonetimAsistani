import type { Category, ProductId, ServiceId, StudioId } from '../../../shared'

// The package catalogue (Doc 2 §5.1, AD-41). A Product is a sellable template —
// what buying it grants. It is DATA: created, edited, deactivated by the owner, never
// a literal in code. `entitlement.productSnapshot` freezes what a member bought, so a
// later catalogue edit can never rewrite history.
//
// Products are never deleted — only deactivated (a deactivated product keeps paying
// the entitlements already sold from it).

export type ProductType = 'credit' | 'period'

// A BUNDLE component (hibrit paket). A bundle product grants ONE entitlement per component, each in
// its OWN category — so the category wall (I-9.7) stays intact: a pilates credit still opens only
// pilates, a fitness entry only fitness. `creditCount` set ⇒ a credit component (N classes); otherwise
// a period-access component capped by `entryAllowance` (N door check-ins; null ⇒ unlimited). The bundle
// itself carries one price and one duration; components have no individual price.
export interface ProductComponent {
  readonly category: Category
  readonly creditCount: number | null
  readonly entryAllowance: number | null
  readonly label: string
}

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
  // ── Fitness serbest-giriş cap (v1.27). Meaningful for a PERIOD (unlimited-access) membership: the
  //    MAX door check-ins allowed. null ⇒ unlimited access (the default). A number ⇒ a soft cap that
  //    each fitness check-in spends (over-use is recorded, not blocked). Credit packages ignore it —
  //    their credits already cap usage. ──
  readonly entryAllowance: number | null
  // Hibrit paket (v1.30): when non-empty, this product is a BUNDLE — selling it grants one entitlement
  // per component (each in its own category). The top-level `category`/`type`/`creditCount` are then a
  // representative face for display/surcharge; the real grants come from `components`. `null`/empty ⇒ a
  // normal single-category product. Absent on products created before this existed.
  readonly components: readonly ProductComponent[] | null
  readonly description: string
  readonly active: boolean
}
