// The entitlements module's only public door (AD-29). It owns the credit ledger
// (Doc 2 §5) and invariants I-1…I-4, I-19, I-20.
export {
  available,
  AdjustmentReasons,
  type AdjustmentReason,
  type CreditGrant,
  type CreditLedger,
  type Entitlement,
  type EntitlementStatus,
  type FreezePeriod,
  type FreezeState,
  type Grant,
  type PeriodGrant,
  type PolicyVersionRef,
  type ProductSnapshot,
} from './domain/types'
export * from './events'
export {
  decideAdjust,
  decideCancel,
  decideConsume,
  decideExpire,
  decideHold,
  decidePurchase,
  decideRelease,
  decideRestore,
  type DecideContext,
  type LedgerOutcome,
} from './domain/decide'
export { purchaseEntitlement, type PurchaseEntitlementInput } from './application/purchase'
export { adjustCredits, type AdjustCreditsInput } from './application/adjust'
export {
  cancelEntitlement,
  expireEntitlement,
  type CancelEntitlementInput,
} from './application/lifecycle'
export type { EntitlementRepository, EntitlementsDeps } from './application/ports'
export { FirestoreEntitlementRepository } from './infrastructure/repos'
// Exposed for cross-aggregate transactions (the booking transaction reads and
// updates the entitlement ledger inside the same transaction as the reservation).
export { entitlementFromFirestore, entitlementToFirestore } from './infrastructure/mappers'
