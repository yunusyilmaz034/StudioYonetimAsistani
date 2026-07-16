// The payroll module's only public door (Plus Phase 9 — Trainer Payroll & Commission). Earnings are
// DERIVED from realised classes + attributed sales against a versioned plan; the only events are the
// human decisions (see README — never a parallel ledger).
export type {
  Adjustment,
  AdjustmentInput,
  AdjustmentKind,
  AttributedSaleInput,
  CompensationModel,
  CompensationPlan,
  CompensationPlanSnapshot,
  CompensationRates,
  EarningLine,
  EarningLineKind,
  PayrollStatement,
  PayrollStatementDraft,
  RealisedClassInput,
  StatementStatus,
} from './domain/types'
export * from './events'
export { computeStatement, planSnapshot, type ComputeStatementInput } from './domain/compute'
export {
  decideFinalizeStatement,
  decidePayStatement,
  decideRecordAdjustment,
  decideSetCompensationPlan,
  type DecideContext as PayrollDecideContext,
  type FinalizeInput,
  type SetPlanInput,
} from './domain/decide'
export type { PayrollDeps, PayrollRepository, ListStatementsQuery } from './application/ports'
export {
  finalizeStatement,
  payStatement,
  recordAdjustment,
  setCompensationPlan,
  statementIdFor,
  type FinalizeServiceInput,
  type RecordAdjustmentServiceInput,
  type SetPlanServiceInput,
} from './application/index'
export { FirestorePayrollRepository } from './infrastructure/repos'
