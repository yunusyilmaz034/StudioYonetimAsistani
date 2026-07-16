'use server'

import {
  FirestorePayrollRepository,
  finalizeStatement,
  instant,
  money,
  payStatement,
  recordAdjustment,
  setCompensationPlan,
  systemClock,
  type PayrollDeps,
  type TenantContext,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { loadStatementDraft, listPayrollTrainers, periodKeyFor, type StatementLoad } from '../payroll-query'

// ── TRAINER PAYROLL web actions (Plus Phase 9). Payroll is OWNER-CONFIDENTIAL: only the owner (and
//    platform_admin) sees the studio's pay; a trainer sees ONLY her own; reception has NO access. ──
const OWNER = ['owner', 'platform_admin'] as const
const OWN = ['trainer', 'owner', 'platform_admin'] as const
const SOURCE = 'reception_web'

const deps = (): PayrollDeps => ({ repo: new FirestorePayrollRepository(adminDb()), clock: systemClock })
const actorId = (ctx: TenantContext): string => (ctx.actor as unknown as { id: string }).id

const ratesSchema = z.object({
  baseSalaryKurus: z.number().int().min(0),
  hourlyRateKurus: z.number().int().min(0),
  perClassKurus: z.number().int().min(0),
  perMemberKurus: z.number().int().min(0),
  commissionPercent: z.number().min(0).max(100),
})

// ── Compensation plans ──
export async function setCompensationPlanAction(input: unknown) {
  const p = z
    .object({
      trainerId: z.string().min(1),
      model: z.enum(['fixed', 'hourly', 'per_class', 'per_member', 'commission', 'mixed']),
      rates: ratesSchema,
      payOnPresumed: z.boolean(),
      payOnNoShow: z.boolean(),
      note: z.string().default(''),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  return setCompensationPlan(deps(), ctx, p, SOURCE)
}

export async function getPlanAction(input: unknown) {
  const p = z.object({ trainerId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  return new FirestorePayrollRepository(adminDb()).getPlan(ctx, p.trainerId)
}

export async function listPlansAction() {
  const ctx = await requireTenantContext(OWNER)
  return new FirestorePayrollRepository(adminDb()).listPlans(ctx)
}

export async function listTrainersAction() {
  const ctx = await requireTenantContext(OWNER)
  return listPayrollTrainers(ctx)
}

// ── Adjustments (signed kuruş; a bonus is +, a deduction/advance is −) ──
export async function recordAdjustmentAction(input: unknown) {
  const p = z
    .object({
      trainerId: z.string().min(1),
      periodKey: z.string().min(1),
      kind: z.enum(['bonus', 'deduction', 'correction', 'advance']),
      amountKurus: z.number().int(),
      note: z.string().trim().min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  return recordAdjustment(deps(), ctx, { trainerId: p.trainerId, periodKey: p.periodKey, kind: p.kind, amount: money(p.amountKurus), note: p.note }, SOURCE)
}

// ── The owner report: compute a trainer's draft for a period (weekly/monthly/custom bounds). ──
const periodSchema = z.object({
  trainerId: z.string().min(1),
  periodStart: z.number().int(),
  periodEnd: z.number().int(),
})

export async function statementDraftAction(input: unknown): Promise<StatementLoad> {
  const p = periodSchema.parse(input)
  const ctx = await requireTenantContext(OWNER)
  const asOf = Math.min(p.periodEnd, systemClock.now())
  return loadStatementDraft(ctx, p.trainerId, instant(p.periodStart), instant(p.periodEnd), instant(asOf))
}

// ── Finalize (freeze the period). The draft is recomputed server-side — a client-sent draft is
//    never trusted. ──
export async function finalizeStatementAction(input: unknown) {
  const p = periodSchema.parse(input)
  const ctx = await requireTenantContext(OWNER)
  const asOf = Math.min(p.periodEnd, systemClock.now())
  const load = await loadStatementDraft(ctx, p.trainerId, instant(p.periodStart), instant(p.periodEnd), instant(asOf))
  if (!load.plan || !load.draft) return { ok: false as const, error: { code: 'compensation_plan_missing' as const } }
  return finalizeStatement(deps(), ctx, { periodKey: load.periodKey, draft: load.draft, planVersion: load.plan.version }, SOURCE)
}

export async function payStatementAction(input: unknown) {
  const p = z.object({ statementId: z.string().min(1), amountKurus: z.number().int(), note: z.string().default('') }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  return payStatement(deps(), ctx, p.statementId, money(p.amountKurus), p.note, SOURCE)
}

export async function listStatementsAction(input: unknown) {
  const p = z.object({ from: z.number().int().optional(), to: z.number().int().optional(), trainerId: z.string().optional() }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  // Build the query with only the keys that are present (exactOptionalPropertyTypes).
  const query: { from?: number; to?: number; trainerId?: string } = {}
  if (p.from !== undefined) query.from = p.from
  if (p.to !== undefined) query.to = p.to
  if (p.trainerId !== undefined) query.trainerId = p.trainerId
  return new FirestorePayrollRepository(adminDb()).listStatements(ctx, query)
}

// ── Trainer-own view: a trainer sees ONLY her own draft/statement, never another trainer's. ──
export async function myStatementAction(input: unknown): Promise<StatementLoad> {
  const p = z.object({ periodStart: z.number().int(), periodEnd: z.number().int() }).parse(input)
  const ctx = await requireTenantContext(OWN)
  const trainerId = actorId(ctx)
  const asOf = Math.min(p.periodEnd, systemClock.now())
  return loadStatementDraft(ctx, trainerId, instant(p.periodStart), instant(p.periodEnd), instant(asOf))
}

// Exposed so a caller can label a period consistently with the query bridge.
export async function periodKeyAction(input: unknown) {
  const p = z.object({ periodStart: z.number().int(), periodEnd: z.number().int(), offsetMinutes: z.number().int() }).parse(input)
  await requireTenantContext(OWN)
  return periodKeyFor(instant(p.periodStart), instant(p.periodEnd), p.offsetMinutes)
}
