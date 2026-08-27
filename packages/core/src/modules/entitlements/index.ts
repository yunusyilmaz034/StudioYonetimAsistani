// The entitlements module's only public door (AD-29). It owns the credit ledger
// (Doc 2 §5) and invariants I-1…I-4, I-19, I-20.
export {
  available,
  cancellationsUsed,
  entriesUsed,
  AdjustmentReasons,
  PaymentMethods,
  type AdjustmentReason,
  type CancellationLedger,
  type EntryLedger,
  type CreditGrant,
  type CreditLedger,
  type Entitlement,
  type EntitlementStatus,
  type FreezePeriod,
  type FreezeState,
  type Grant,
  type ManualPayment,
  type PaymentMethod,
  type PeriodGrant,
  type PolicyVersionRef,
  type ProductSnapshot,
} from './domain/types'
// D12 — the single definition of "does this package cover this service?"; the decider and
// the advisory selector both call it, so they cannot drift apart.
export { coversService, isEligibleForService } from './domain/eligibility'
// When a renewal starts (owner, 2026-07-27): behind the package it renews, so no paid day burns
// unused. `blockedByFrozen` is the one case with no honest answer — the caller refuses instead.
export { blockedByFrozen, nextBundleStart, nextPackageStart, type BundleStart } from './domain/renewal'
// A second press is not a second sale (owner, 2026-07-29).
export { DUPLICATE_SALE_WINDOW_MS, isSuspectedDuplicate, type RecentSale } from './domain/duplicate'
export * from './events'
export {
  decideAdjust,
  decideAmend,
  decideCancel,
  decideChargeCancellation,
  decideRefundCancellation,
  decideConsumeEntry,
  decideRestoreEntry,
  decideRevokeEntry,
  decideConsume,
  decideExpire,
  decideExtend,
  decideHold,
  decidePurchase,
  decideReactivate,
  decideRecordPayment,
  decideRelease,
  decideRestore,
  type AmendPatch,
  type DecideContext,
  type LedgerOutcome,
} from './domain/decide'
export { purchaseEntitlement, type PurchaseEntitlementInput } from './application/purchase'
export { adjustCredits, adjustEntries, type AdjustCreditsInput, type AdjustEntriesInput } from './application/adjust'
export {
  assignSubscription,
  amendEntitlement,
  reactivateEntitlement,
  type AssignSubscriptionInput,
  type AmendEntitlementInput,
} from './application/subscription'
export {
  cancelEntitlement,
  expireEntitlement,
  sweepExpireCredits,
  type CancelEntitlementInput,
  type ExpirySummary,
} from './application/lifecycle'
export type { EntitlementEventRecord, EntitlementRepository, EntitlementsDeps } from './application/ports'
export { FirestoreEntitlementRepository } from './infrastructure/repos'
// Exposed for cross-aggregate transactions (the booking transaction reads and
// updates the entitlement ledger inside the same transaction as the reservation).
export { entitlementFromFirestore, entitlementToFirestore } from './infrastructure/mappers'

// v1.27 S3 — freeze (closes DEBT-009).
export {
  freezeEntitlement,
  runFreezeBudgetSweep,
  unfreezeEntitlement,
} from './application/freeze'
export { decideFreeze, decideUnfreeze, freezeDaysRemaining } from './domain/decide'
export {
  ENTITLEMENT_FROZEN,
  ENTITLEMENT_UNFROZEN,
  type EntitlementFrozenPayload,
  type EntitlementUnfrozenPayload,
} from './events'
