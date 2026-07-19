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
// The till has to EXIST before it can be opened, and creating one is a state change — so it writes
// an event, like every other state change in this system (#1). Until now there was no way to create
// one at all: `openDrawer` refused a drawer that did not exist, and nothing created it. A studio
// with no till can take no cash, and every cash sale was refused (`drawer_required`).
export const DRAWER_CREATED = 'drawer.created'
export const DRAWER_OPENED = 'drawer.opened'
export const DRAWER_CLOSED = 'drawer.closed'
export const DRAWER_DISCREPANCY = 'drawer.discrepancy_recorded'
// PF-15 — a till is renamed or retired (archived), never deleted; its history stays intact.
export const DRAWER_RENAMED = 'drawer.renamed'
export const DRAWER_ARCHIVED = 'drawer.archived'
export const DRAWER_REACTIVATED = 'drawer.reactivated'
export const GIFTCARD_ISSUED = 'giftcard.issued'
export const GIFTCARD_REDEEMED = 'giftcard.redeemed'
export const COUPON_CREATED = 'coupon.created'
export const COUPON_REDEEMED = 'coupon.redeemed'
export const PLAN_CREATED = 'plan.created'
export const PLAN_INSTALMENT_PAID = 'plan.instalment_paid'
export const PLAN_CANCELLED = 'plan.cancelled'
// ── Shareable PAYTR links + unattributed collections (PF-37) ──
export const PAYMENT_LINK_CREATED = 'payment_link.created'
export const PAYMENT_LINK_DEACTIVATED = 'payment_link.deactivated'
export const PAYTR_COLLECTION_RECEIVED = 'paytr_collection.received'
export const PAYTR_COLLECTION_RECONCILED = 'paytr_collection.reconciled'
export const PAYTR_COLLECTION_CANCELLED = 'paytr_collection.cancelled'

// ── Member WALLET (Doc 27 / v1.27). A gift card with the member's name: money in (topup), money out
//    (purchase, method 'wallet'), refunds, reasoned adjustments, and a void. Balance is DERIVED, never
//    spent below zero (I-37). Every payload carries `balanceAfter` so the log alone reconstructs it. ──
export const WALLET_TOPUP = 'wallet.topup'
export const WALLET_PURCHASE = 'wallet.purchase'
export const WALLET_REFUND = 'wallet.refund'
export const WALLET_ADJUSTMENT = 'wallet.adjustment'
export const WALLET_VOIDED = 'wallet.voided'

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

export type DrawerCreatedPayload = {
  readonly name: string
  readonly kind: 'cash' | 'pos'
}

// PF-15 — previousName carries the audit trail (the new name is on the till state).
export type DrawerRenamedPayload = {
  readonly previousName: string
  readonly name: string
}
export type DrawerArchivedPayload = { readonly name: string }
export type DrawerReactivatedPayload = { readonly name: string }

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

// ── Wallet payloads. `amount` is always POSITIVE (kuruş); the event TYPE says the direction. Money in
//    (topup/refund/adjustment-credit) raises the balance; money out (purchase/void/adjustment-debit)
//    lowers it. `balanceAfter` is the derived balance once this event is applied. No PII (#6). ──
export type WalletTopupSource = 'pos' | 'cash' | 'bank_transfer' | 'manual'
export type WalletAdjustReason = 'gift' | 'correction' | 'migration' | 'support'

export type WalletTopupPayload = {
  readonly amount: Money
  readonly source: WalletTopupSource
  readonly paymentId: string | null
  readonly providerRef: string | null
  readonly balanceAfter: Money
}
export type WalletPurchasePayload = {
  readonly amount: Money
  readonly saleId: string
  readonly paymentId: string
  readonly balanceAfter: Money
}
export type WalletRefundPayload = {
  readonly amount: Money
  readonly reason: string
  readonly originalSaleId: string | null
  readonly balanceAfter: Money
}
export type WalletAdjustmentPayload = {
  readonly direction: 'credit' | 'debit'
  readonly amount: Money
  readonly reason: WalletAdjustReason
  readonly note: string
  readonly balanceAfter: Money
}
export type WalletVoidedPayload = {
  readonly amount: Money
  readonly topupId: string
  readonly reason: string
  readonly balanceAfter: Money
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

// ── PF-37 payloads. NO PII (#6): the buyer's name/phone live on the PaytrCollection STATE, never here.
//    Money is Money (integer kuruş). The memberId on reconcile is opaque, so it is safe in the log.
export type PaymentLinkCreatedPayload = {
  readonly linkId: string
  readonly amount: Money
  readonly maxInstallments: number
}
export type PaymentLinkDeactivatedPayload = {
  readonly linkId: string
}
export type PaytrCollectionReceivedPayload = {
  readonly collectionId: string
  readonly linkId: string
  readonly amount: Money
  readonly installments: number
}
export type PaytrCollectionReconciledPayload = {
  readonly collectionId: string
  readonly memberId: MemberId
  readonly paymentId: string
}
export type PaytrCollectionCancelledPayload = {
  readonly collectionId: string
  readonly reason: string
}
