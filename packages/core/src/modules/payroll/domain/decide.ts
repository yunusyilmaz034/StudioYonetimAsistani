import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type Money,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  COMPENSATION_PLAN_SET,
  PAYROLL_ADJUSTMENT_RECORDED,
  PAYROLL_STATEMENT_FINALIZED,
  PAYROLL_STATEMENT_PAID,
} from '../events'
import type {
  Adjustment,
  AdjustmentInput,
  CompensationModel,
  CompensationPlan,
  CompensationRates,
  PayrollStatement,
  PayrollStatementDraft,
} from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(ctx: DecideContext, kind: AggregateKind, id: string, extra: Record<string, unknown> = {}) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind, id },
    related: extra,
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// ── Compensation plan (versioned policy) ───────────────────────────────────────────────────────
export interface SetPlanInput {
  readonly trainerId: string
  readonly model: CompensationModel
  readonly rates: CompensationRates
  readonly payOnPresumed: boolean
  readonly payOnNoShow: boolean
  readonly note: string
}

const KURUS_RATES: readonly (keyof CompensationRates)[] = ['baseSalaryKurus', 'hourlyRateKurus', 'perClassKurus', 'perMemberKurus']

// The rate a given model REQUIRES to be non-zero — a `per_class` plan with no per-class rate is a
// mistake, not a free trainer. `mixed` requires at least one component (checked separately).
const REQUIRED: Record<CompensationModel, keyof CompensationRates | null> = {
  fixed: 'baseSalaryKurus',
  hourly: 'hourlyRateKurus',
  per_class: 'perClassKurus',
  per_member: 'perMemberKurus',
  commission: 'commissionPercent',
  mixed: null,
}

export function decideSetCompensationPlan(
  ctx: DecideContext,
  current: CompensationPlan | null,
  input: SetPlanInput,
): Result<{ next: CompensationPlan; events: NewEvent[] }, DomainError> {
  const r = input.rates
  for (const k of KURUS_RATES) {
    if (!Number.isInteger(r[k]) || r[k] < 0) return err({ code: 'invalid_compensation_rate' })
  }
  if (r.commissionPercent < 0 || r.commissionPercent > 100) return err({ code: 'invalid_commission_percent' })

  const required = REQUIRED[input.model]
  if (required && r[required] <= 0) return err({ code: 'invalid_compensation_rate' })
  if (input.model === 'mixed' && KURUS_RATES.every((k) => r[k] <= 0) && r.commissionPercent <= 0) {
    return err({ code: 'invalid_compensation_rate' })
  }

  const version = (current?.version ?? 0) + 1
  const next: CompensationPlan = {
    id: input.trainerId,
    studioId: ctx.studioId,
    trainerId: input.trainerId,
    version,
    model: input.model,
    rates: r,
    payOnPresumed: input.payOnPresumed,
    payOnNoShow: input.payOnNoShow,
    note: input.note,
    active: true,
    updatedAt: ctx.now,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'compensation_plan', next.id, { trainerId: input.trainerId }),
        type: COMPENSATION_PLAN_SET,
        payload: { trainerId: input.trainerId, version, model: input.model },
      },
    ],
  })
}

// ── Adjustment (a manual, signed money line — the note stays off the log) ─────────────────────────
export function decideRecordAdjustment(
  ctx: DecideContext,
  trainerId: string,
  periodKey: string,
  input: AdjustmentInput,
): Result<{ adjustment: Adjustment; events: NewEvent[] }, DomainError> {
  if (!Number.isInteger(input.amount.amount) || input.amount.amount === 0) return err({ code: 'invalid_amount' })
  if (input.note.trim().length === 0) return err({ code: 'note_required' })

  const adjustment: Adjustment = {
    id: input.adjustmentId,
    studioId: ctx.studioId,
    trainerId,
    periodKey,
    kind: input.kind,
    amount: input.amount,
    note: input.note,
    recordedAt: ctx.now,
  }
  return ok({
    adjustment,
    events: [
      {
        ...base(ctx, 'payroll_statement', `${trainerId}__${periodKey}`, { trainerId }),
        type: PAYROLL_ADJUSTMENT_RECORDED,
        payload: { adjustmentId: input.adjustmentId, trainerId, periodKey, kind: input.kind, amount: input.amount },
      },
    ],
  })
}

// ── Finalize (freeze a period's computed statement — the idempotency + reproducibility anchor) ────
export interface FinalizeInput {
  readonly statementId: string
  readonly periodKey: string
  readonly draft: PayrollStatementDraft
  readonly planVersion: number
}

export function decideFinalizeStatement(
  ctx: DecideContext,
  existing: PayrollStatement | null,
  input: FinalizeInput,
): Result<{ next: PayrollStatement; events: NewEvent[] }, DomainError> {
  // Re-finalizing a period is REFUSED, not repeated — a paid statement must never be silently
  // recomputed after attendance corrections land.
  if (existing) return err({ code: 'payroll_already_finalized' })
  if (input.draft.periodEnd <= input.draft.periodStart) return err({ code: 'invalid_time_range' })

  const next: PayrollStatement = {
    id: input.statementId,
    studioId: ctx.studioId,
    trainerId: input.draft.trainerId,
    periodKey: input.periodKey,
    periodStart: input.draft.periodStart,
    periodEnd: input.draft.periodEnd,
    status: 'finalized',
    planVersion: input.planVersion,
    draft: input.draft,
    finalizedAt: ctx.now,
    paidAt: null,
    paidNote: null,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payroll_statement', input.statementId, { trainerId: input.draft.trainerId, statementId: input.statementId }),
        type: PAYROLL_STATEMENT_FINALIZED,
        payload: {
          statementId: input.statementId,
          trainerId: input.draft.trainerId,
          periodKey: input.periodKey,
          periodStart: input.draft.periodStart,
          periodEnd: input.draft.periodEnd,
          planVersion: input.planVersion,
          earningsTotal: input.draft.earningsTotal,
          adjustmentsTotal: input.draft.adjustmentsTotal,
          netPayable: input.draft.netPayable,
          classCount: input.draft.classCount,
        },
      },
    ],
  })
}

// ── Pay (records that the trainer was settled — no kasa movement; expense ledger is out of scope) ──
export function decidePayStatement(
  ctx: DecideContext,
  statement: PayrollStatement,
  amountPaid: Money,
  note: string,
): Result<{ next: PayrollStatement; events: NewEvent[] }, DomainError> {
  if (statement.status === 'paid') return err({ code: 'statement_already_paid' })
  if (statement.status !== 'finalized') return err({ code: 'statement_not_finalized' })

  const next: PayrollStatement = { ...statement, status: 'paid', paidAt: ctx.now, paidNote: note }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payroll_statement', statement.id, { trainerId: statement.trainerId, statementId: statement.id }),
        type: PAYROLL_STATEMENT_PAID,
        payload: { statementId: statement.id, trainerId: statement.trainerId, amountPaid },
      },
    ],
  })
}
