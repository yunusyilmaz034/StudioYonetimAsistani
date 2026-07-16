import type { Instant, Money } from '../../shared'
import type { AdjustmentKind, CompensationModel } from './domain/types'

// Payroll events — ONLY the human decisions. Earnings themselves are derived on read and never
// written as events (that would be a parallel ledger, the roadmap's §9 warning). No PII (I-13): a
// trainer id is opaque, an adjustment's free-text note stays on state, amounts are money not identity.

export const COMPENSATION_PLAN_SET = 'compensation_plan.set'
export const PAYROLL_ADJUSTMENT_RECORDED = 'payroll.adjustment_recorded'
export const PAYROLL_STATEMENT_FINALIZED = 'payroll.statement_finalized'
export const PAYROLL_STATEMENT_PAID = 'payroll.statement_paid'

// The rate VALUES live on the versioned plan document; the event records THAT a version was set and
// which model — enough to audit "the rate changed on this day", the same shape as service.policy_published.
export type CompensationPlanSetPayload = {
  readonly trainerId: string
  readonly version: number
  readonly model: CompensationModel
}

// The note is NOT here (it may name a member — PII stays off the log). Kind + signed amount only.
export type PayrollAdjustmentRecordedPayload = {
  readonly adjustmentId: string
  readonly trainerId: string
  readonly periodKey: string
  readonly kind: AdjustmentKind
  readonly amount: Money
}

// Finalizing FREEZES the period. The frozen line-level snapshot lives on the statement document; the
// event carries the totals so the audit log can show what was owed without re-deriving it.
export type PayrollStatementFinalizedPayload = {
  readonly statementId: string
  readonly trainerId: string
  readonly periodKey: string
  readonly periodStart: Instant
  readonly periodEnd: Instant
  readonly planVersion: number
  readonly earningsTotal: Money
  readonly adjustmentsTotal: Money
  readonly netPayable: Money
  readonly classCount: number
}

export type PayrollStatementPaidPayload = {
  readonly statementId: string
  readonly trainerId: string
  readonly amountPaid: Money
}
