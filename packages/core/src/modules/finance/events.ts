import type { Instant, Money, MemberId } from '../../shared'
import type { DiscountReason, PaymentMethod } from './domain/types'

// Finance events (v1.24). No PII (#6): a member is an id, a coupon is a code, a card is an id.
// Every one carries the actor, the two timestamps and the OperationId (= correlationId, OP-2), so a
// sale, the payment that settled it and the entitlement it granted read as ONE act in the Activity
// Center — which is the owner's second principle for this milestone.

export const SALE_CREATED = 'sale.created'
export const SALE_CANCELLED = 'sale.cancelled'
export const SALE_SETTLED = 'sale.settled'
export const PAYMENT_RECEIVED = 'payment.received'
export const PAYMENT_VOIDED = 'payment.voided'
export const PAYMENT_REFUNDED = 'payment.refunded'
export const ALLOCATION_APPLIED = 'allocation.applied'
export const DRAWER_OPENED = 'drawer.opened'
export const DRAWER_CLOSED = 'drawer.closed'
export const DRAWER_DISCREPANCY = 'drawer.discrepancy_recorded'
export const GIFTCARD_ISSUED = 'giftcard.issued'
export const GIFTCARD_REDEEMED = 'giftcard.redeemed'
export const COUPON_CREATED = 'coupon.created'
export const COUPON_REDEEMED = 'coupon.redeemed'
export const PLAN_CREATED = 'plan.created'
export const PLAN_INSTALMENT_PAID = 'plan.instalment_paid'
export const PLAN_CANCELLED = 'plan.cancelled'

export type SaleCreatedPayload = {
  readonly gross: Money
  readonly discountTotal: Money
  readonly total: Money // what the studio is OWED — "satış" (owner D-1)
  readonly lineCount: number
  readonly discountReasons: readonly DiscountReason[]
  readonly soldByType: string // the actor KIND; the id is in the envelope's actor (no duplication)
}

export type SaleCancelledPayload = {
  readonly reason: string
  readonly total: Money // so revenue can go NET without a projector ever reading state
  readonly paidBack: Money
}

export type SaleSettledPayload = {
  readonly total: Money
}

export type PaymentReceivedPayload = {
  readonly amount: Money // what actually MOVED — "tahsilat" (cash basis, owner OQ-2)
  readonly method: PaymentMethod
  readonly drawerId: string | null
  readonly giftCardId: string | null
  readonly providerRef: string | null
}

export type PaymentVoidedPayload = {
  readonly amount: Money
  readonly reason: string // mandatory (I-36)
  readonly method: PaymentMethod
}

export type PaymentRefundedPayload = {
  readonly amount: Money
  readonly method: PaymentMethod
  readonly reason: string
  readonly paymentId: string | null
}

export type AllocationAppliedPayload = {
  readonly paymentId: string
  readonly saleId: string
  readonly amount: Money
  readonly saleBalanceAfter: Money // AD-19: the post-state of every number the event changed
  readonly paymentUnallocatedAfter: Money
}

export type DrawerOpenedPayload = {
  readonly openingFloat: Money
  readonly kind: 'cash' | 'pos'
}

export type DrawerClosedPayload = {
  readonly expected: Money
  readonly counted: Money
  readonly discrepancy: Money
  readonly note: string | null
}

// A day-end that quietly makes the numbers agree is not a control, it is a cover-up. The
// discrepancy is its own event so it can never be lost in a closing summary.
export type DrawerDiscrepancyPayload = {
  readonly expected: Money
  readonly counted: Money
  readonly discrepancy: Money
  readonly note: string
}

export type GiftCardIssuedPayload = {
  readonly value: Money
  readonly saleId: string | null
  readonly issuedToMemberId: MemberId | null
  readonly validUntil: Instant | null
}

export type GiftCardRedeemedPayload = {
  readonly amount: Money
  readonly remainingAfter: Money
  readonly paymentId: string
}

export type CouponCreatedPayload = {
  readonly code: string
  readonly kind: 'percent' | 'amount'
  readonly value: number
}

export type CouponRedeemedPayload = {
  readonly code: string
  readonly discount: Money
  readonly saleId: string
  readonly redemptionsAfter: number
}

export type PlanCreatedPayload = {
  readonly saleId: string
  readonly instalmentCount: number
  readonly total: Money
  readonly firstDueAt: Instant
}

export type PlanInstalmentPaidPayload = {
  readonly saleId: string
  readonly seq: number
  readonly amount: Money
  readonly paymentId: string
  readonly remainingInstalments: number
}

export type PlanCancelledPayload = {
  readonly saleId: string
  readonly reason: string
}
