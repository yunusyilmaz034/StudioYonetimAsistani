import type { Category, EntitlementId, Instant, MemberId, Money, ProductId, StudioId } from '../../../shared'

// The entitlement aggregate and its credit ledger (Doc 2 §5). This is the money
// core: one aggregate, two shapes (credits | period), discriminated by grant.kind.
// PURE domain types — no firebase-admin, no clock, no zod.

// ── What buying a product gives you (Doc 2 §5.1). Frozen into the entitlement at
//    purchase, so a later catalogue edit can never rewrite what a member bought. ──
export type CreditGrant = {
  readonly kind: 'credits'
  readonly credits: number
  readonly validForDays: number
}
export type PeriodGrant = {
  readonly kind: 'period'
  readonly durationDays: number
  readonly access: 'unlimited'
}
export type Grant = CreditGrant | PeriodGrant

// What the member actually bought, frozen at purchase (Doc 2 §5.2). `category` is a
// closed enum because the category wall (I-9.7) compares it to the session's.
export type ProductSnapshot = {
  readonly productId: ProductId
  readonly name: string
  readonly category: Category
  readonly grant: Grant
  readonly listPrice: Money
}

export type EntitlementStatus = 'active' | 'frozen' | 'expired' | 'cancelled'

// Manual, record-only payment for a subscription (v1.14). Deliberately NOT a payment
// aggregate or allocation engine — a clean seam that a future `payments` module can
// migrate from. Revenue is `collectedAmount` on `recordedAt` (Doc 2 §6). null ⇔ comp
// / sold-on-account (balanceDue > 0 is legal, OQ-10).
export const PaymentMethods = ['cash', 'credit_card', 'bank_transfer'] as const
export type PaymentMethod = (typeof PaymentMethods)[number]

export type ManualPayment = {
  readonly collectedAmount: Money
  readonly method: PaymentMethod
  readonly note: string | null
  readonly recordedAt: Instant
}

// The credit ledger — six monotonically non-decreasing counters (I-3). `available`
// is DERIVED (never stored as truth), denormalised for reads (AD-14):
//   available = granted + restored − consumed − held − revoked − expired
export type CreditLedger = {
  readonly granted: number // what the product gave. Set at purchase, never touched again.
  readonly held: number // open reservations not yet resolved
  readonly consumed: number // spent through a RESOLVED reservation
  readonly restored: number // a consumed credit given back
  readonly revoked: number // an admin adjustment took a credit away — never `consumed`
  readonly expired: number // burned at validUntil, unused — the churn signal
}

// Freeze is modelled here so the aggregate shape is stable and I-8 holds, but the
// freeze/unfreeze OPERATIONS are deferred (their arithmetic is an open question).
export type FreezePeriod = {
  readonly from: string // LocalDate
  readonly to: string // LocalDate
}
export type FreezeState = {
  readonly entitledDays: number
  readonly usedDays: number
  readonly periods: readonly FreezePeriod[]
  readonly activeFrom: string | null // LocalDate ⇔ currently frozen
}

// D3 — the rules AS THEY WERE at purchase. Mirrors shared PolicyRef.
export type PolicyVersionRef = {
  readonly policyId: string
  readonly version: number
}

export type Entitlement = {
  readonly id: EntitlementId
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly productId: ProductId
  readonly productSnapshot: ProductSnapshot
  readonly policyRef: PolicyVersionRef

  readonly status: EntitlementStatus
  readonly validFrom: Instant
  readonly validUntil: Instant // freeze moves this forward (freeze op deferred)

  readonly credits: CreditLedger | null // null ⇔ period entitlement
  readonly freeze: FreezeState | null // null ⇔ freezing not permitted

  // What was owed, and what has been collected (payment is optional, OQ-10).
  readonly priceAgreed: Money
  readonly paidTotal: Money // denormalised; mirrors manualPayment.collectedAmount (v1.14)
  readonly manualPayment: ManualPayment | null // the record-only payment seam (v1.14)

  readonly purchasedAt: Instant
}

export const AdjustmentReasons = ['gift', 'correction', 'migration', 'support'] as const
export type AdjustmentReason = (typeof AdjustmentReasons)[number]

// ── Derived ledger value. Never stored as truth; recomputed and denormalised. ──
export function available(l: CreditLedger): number {
  return l.granted + l.restored - l.consumed - l.held - l.revoked - l.expired
}
