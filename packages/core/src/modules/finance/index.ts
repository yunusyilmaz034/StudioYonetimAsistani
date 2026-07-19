// The finance module's only public door (v1.24, Doc 26). It owns the money ledger and the
// invariants I-31…I-36:
//   I-31 a payment is never mutated (voided, with a reason)
//   I-32 Σ allocations(payment) ≤ payment.amount
//   I-33 a sale never goes below zero; an over-payment is member credit
//   I-34 a discount is an AMOUNT stamped at sale time, never a percentage re-applied later
//   I-35 a gift card is never spent below zero — refused, never clamped
//   I-36 every discretionary money movement carries an actor and a reason
export type {
  Allocation,
  CashDrawer,
  Coupon,
  Discount,
  DiscountReason,
  GiftCard,
  Instalment,
  Payment,
  PaymentMethod as FinancePaymentMethod,
  PaymentPlan,
  Refund,
  Sale,
  SaleLine,
  SaleStatus,
  Wallet,
} from './domain/types'
export {
  giftCardRemaining,
  memberBalance,
  paymentUnallocated,
  saleBalanceDue,
} from './domain/types'
export * from './events'
export {
  couponDiscount,
  decideAllocate,
  decideCancelSale,
  decideCloseDrawer,
  decideCreateDrawer,
  decideCreatePlan,
  decideCreateSale,
  decideIssueGiftCard,
  decideOpenDrawer,
  decideReceivePayment,
  decideRefund,
  decideVoidPayment,
  decideWalletAdjustment,
  decideWalletPurchase,
  decideWalletRefund,
  decideWalletTopup,
  decideWalletVoid,
} from './domain/decide'
export {
  cancelSale,
  closeDrawer,
  createDrawer,
  collect,
  createPlan,
  issueGiftCard,
  loadMemberAccount,
  openDrawer,
  refund,
  renameDrawer,
  resolveCoupon,
  sell,
  setDrawerActive,
  voidPayment,
  type CollectInput,
  type MemberAccount,
  type SellInput,
} from './application/finance'
export type { FinanceDeps, FinanceRepository, FinanceWrite } from './application/ports'
export { FirestoreFinanceRepository } from './infrastructure/repos'
export {
  amountDue,
  sellPackage,
  type SellPackageDeps,
  type SellPackageInput,
  type SellPackagePayment,
} from './application/sell-package'
export {
  debtByMember,
  moneyByEntitlement,
  type EntitlementMoney,
} from './application/entitlement-money'
// PF-37 — shareable PAYTR links + unattributed collections (a separate aggregate; the ledger is untouched).
export type { PaymentLink, PaytrCollection, PaytrCollectionStatus } from './domain/types'
export { FirestorePaymentLinkRepository, FirestorePaytrCollectionRepository } from './infrastructure/paytr-repos'
export {
  cancelCollection,
  createPaymentLink,
  deactivatePaymentLink,
  receiveCollection,
  reconcileCollection,
  type PaytrDeps,
} from './application/paytr'
