import type { Clock, NewEvent, TenantContext } from '../../../shared'
import type { Adjustment, CompensationPlan, PayrollStatement } from '../domain/types'

// The payroll repository port. Infrastructure (FirestorePayrollRepository) implements it; the
// application composes the pure deciders against it. State + events always commit together (#1).
// Earnings are never stored — only the human decisions (plan, adjustment, finalize, pay).
export interface ListStatementsQuery {
  readonly trainerId?: string
  readonly from?: number
  readonly to?: number
}

export interface PayrollRepository {
  getPlan(ctx: TenantContext, trainerId: string): Promise<CompensationPlan | null>
  listPlans(ctx: TenantContext): Promise<readonly CompensationPlan[]>
  savePlan(ctx: TenantContext, plan: CompensationPlan, events: readonly NewEvent[]): Promise<void>

  getStatement(ctx: TenantContext, statementId: string): Promise<PayrollStatement | null>
  listStatements(ctx: TenantContext, query: ListStatementsQuery): Promise<readonly PayrollStatement[]>
  saveStatement(ctx: TenantContext, statement: PayrollStatement, events: readonly NewEvent[]): Promise<void>

  saveAdjustment(ctx: TenantContext, adjustment: Adjustment, events: readonly NewEvent[]): Promise<void>
  listAdjustments(ctx: TenantContext, trainerId: string, periodKey: string): Promise<readonly Adjustment[]>
}

export interface PayrollDeps {
  readonly repo: PayrollRepository
  readonly clock: Clock
}
