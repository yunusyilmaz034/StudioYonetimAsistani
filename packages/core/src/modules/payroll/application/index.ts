import {
  newCorrelationId,
  newPayrollAdjustmentId,
  type DomainError,
  type EventSource,
  type Instant,
  type Money,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideFinalizeStatement,
  decidePayStatement,
  decideRecordAdjustment,
  decideSetCompensationPlan,
  type DecideContext,
} from '../domain/decide'
import type { Adjustment, AdjustmentKind, CompensationModel, CompensationPlan, CompensationRates, PayrollStatement, PayrollStatementDraft } from '../domain/types'
import type { PayrollDeps } from './ports'

export type { PayrollDeps, PayrollRepository, ListStatementsQuery } from './ports'

function dctx(deps: PayrollDeps, ctx: TenantContext, source: EventSource): DecideContext {
  return { studioId: ctx.studioId, actor: ctx.actor, now: deps.clock.now(), correlationId: newCorrelationId(), source }
}

// The deterministic statement id — a period is one statement per trainer, so finalizing is idempotent
// on the id, not on a fresh mint.
export const statementIdFor = (trainerId: string, periodKey: string): string => `${trainerId}__${periodKey}`

// ── Set / version a compensation plan ──
export interface SetPlanServiceInput {
  readonly trainerId: string
  readonly model: CompensationModel
  readonly rates: CompensationRates
  readonly payOnPresumed: boolean
  readonly payOnNoShow: boolean
  readonly note: string
}

export async function setCompensationPlan(
  deps: PayrollDeps,
  ctx: TenantContext,
  input: SetPlanServiceInput,
  source: EventSource,
): Promise<Result<CompensationPlan, DomainError>> {
  const current = await deps.repo.getPlan(ctx, input.trainerId)
  const r = decideSetCompensationPlan(dctx(deps, ctx, source), current, input)
  if (!r.ok) return r
  await deps.repo.savePlan(ctx, r.value.next, r.value.events)
  return { ok: true, value: r.value.next }
}

// ── Record a manual adjustment ──
export interface RecordAdjustmentServiceInput {
  readonly trainerId: string
  readonly periodKey: string
  readonly kind: AdjustmentKind
  readonly amount: Money
  readonly note: string
}

export async function recordAdjustment(
  deps: PayrollDeps,
  ctx: TenantContext,
  input: RecordAdjustmentServiceInput,
  source: EventSource,
): Promise<Result<Adjustment, DomainError>> {
  const r = decideRecordAdjustment(dctx(deps, ctx, source), input.trainerId, input.periodKey, {
    adjustmentId: newPayrollAdjustmentId(),
    kind: input.kind,
    amount: input.amount,
    note: input.note,
  })
  if (!r.ok) return r
  await deps.repo.saveAdjustment(ctx, r.value.adjustment, r.value.events)
  return { ok: true, value: r.value.adjustment }
}

// ── Finalize (freeze the period). The DRAFT is computed server-side by the caller and passed in;
//    the service loads any existing statement to enforce idempotency. ──
export interface FinalizeServiceInput {
  readonly periodKey: string
  readonly draft: PayrollStatementDraft
  readonly planVersion: number
}

export async function finalizeStatement(
  deps: PayrollDeps,
  ctx: TenantContext,
  input: FinalizeServiceInput,
  source: EventSource,
): Promise<Result<PayrollStatement, DomainError>> {
  const statementId = statementIdFor(input.draft.trainerId, input.periodKey)
  const existing = await deps.repo.getStatement(ctx, statementId)
  const r = decideFinalizeStatement(dctx(deps, ctx, source), existing, {
    statementId,
    periodKey: input.periodKey,
    draft: input.draft,
    planVersion: input.planVersion,
  })
  if (!r.ok) return r
  await deps.repo.saveStatement(ctx, r.value.next, r.value.events)
  return { ok: true, value: r.value.next }
}

// ── Mark a finalized statement paid ──
export async function payStatement(
  deps: PayrollDeps,
  ctx: TenantContext,
  statementId: string,
  amountPaid: Money,
  note: string,
  source: EventSource,
): Promise<Result<PayrollStatement, DomainError>> {
  const statement = await deps.repo.getStatement(ctx, statementId)
  if (!statement) return { ok: false, error: { code: 'statement_not_finalized' } }
  const r = decidePayStatement(dctx(deps, ctx, source), statement, amountPaid, note)
  if (!r.ok) return r
  await deps.repo.saveStatement(ctx, r.value.next, r.value.events)
  return { ok: true, value: r.value.next }
}

// Re-exported for callers building period bounds.
export type { Instant }
