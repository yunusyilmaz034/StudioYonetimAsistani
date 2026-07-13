// The operations module's only public door (AD-29). D21 + D22 (v1.22).
//
// The most dangerous acts in the product: they cancel classes, release credits and extend
// packages across hundreds of objects. Preview → approve → apply → **never twice** (I-28).
export {
  type BulkAction,
  type BulkOperation,
  type BulkPlan,
  type BulkSummary,
  type BlockedSession,
  type ClosurePlan,
  type ClosureSummary,
  type EntitlementSkipReason,
  type OperationScope,
  type OperationStatus,
  type PlannedEntitlement,
  type PlannedSession,
  type SessionSkipReason,
  type SkippedEntitlement,
  type StudioClosure,
} from './domain/types'
export { computeBulkPlan, computeClosurePlan, type ClosureWorld } from './domain/plan'
export {
  decideBulkApplicable,
  decideBulkApplied,
  decideBulkPlanned,
  decideClosureApplicable,
  decideClosureApplied,
  decideClosureCancelled,
  decideCloseurePlanned,
  type DecideContext as OperationsDecideContext,
} from './domain/decide'
export * from './events'
export {
  applyClosure,
  planClosure,
  previewClosure,
  type ClosureDeps,
  type PlanClosureInput,
} from './application/closure'
export {
  applyBulk,
  planBulk,
  previewBulk,
  type BulkDeps,
  type PlanBulkInput,
} from './application/bulk'
export type { OperationsDeps, OperationsRepository } from './application/ports'
export { FirestoreOperationsRepository } from './infrastructure/repos'
export {
  allStudioIds,
  runDeepChecks,
  runFastChecks,
  type HealthAlert,
  type HealthFinding,
  type HealthReport,
} from './infrastructure/health'
