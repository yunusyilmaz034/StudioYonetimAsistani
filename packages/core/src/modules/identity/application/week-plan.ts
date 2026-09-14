import {
  err,
  localDateAt,
  newCorrelationId,
  type DomainError,
  type EventSource,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideApproveWeekPlan,
  decideReturnWeekPlan,
  decideSaveWeekPlanDraft,
  decideSubmitWeekPlan,
} from '../domain/week-plan'
import type { StaffWeekPlan, WeekPlanEntries } from '../domain/types'
import type { StaffWeekPlanDeps } from './ports'

// ── HAFTALIK VARDİYA PLANI — use-case'ler (owner, 2026-09-14 · OR-77) ──────────────────────
//
// Dördü de aynı şekli izliyor: oku → karar ver (saf) → yaz, TEK işlemde (`updateWeekPlan`).
// Resepsiyon kaydederken owner onaylıyorsa, onaylanan plan onay anında okunan plandır.

const SOURCE: EventSource = 'reception_web'
const TARIH = /^\d{4}-\d{2}-\d{2}$/

const dctx = (deps: StaffWeekPlanDeps, ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source: SOURCE,
})

/** "Geçmiş hafta" kuralındaki bugün, stüdyonun yerel günü. */
const bugun = (deps: StaffWeekPlanDeps) => localDateAt(deps.clock.now(), deps.utcOffsetMinutes)

// Belge kimliği haftanın tarihi. Biçimi yola dokunmadan ÖNCE sınanır: karar fonksiyonu da sınıyor,
// ama o çalıştığında `staffWeekPlans/<girdi>` yolu çoktan kurulmuş olurdu.
const gecersiz = (weekStart: string): Result<never, DomainError> | null =>
  TARIH.test(weekStart) ? null : err({ code: 'week_plan_invalid' })

export function saveWeekPlanDraft(
  deps: StaffWeekPlanDeps,
  ctx: TenantContext,
  input: { readonly weekStart: string; readonly entries: WeekPlanEntries },
): Promise<Result<StaffWeekPlan, DomainError>> {
  const red = gecersiz(input.weekStart)
  if (red) return Promise.resolve(red)
  const c = dctx(deps, ctx)
  const today = bugun(deps)
  return deps.repo.updateWeekPlan(ctx, input.weekStart, (current) => decideSaveWeekPlanDraft(c, current, input, today))
}

export function submitWeekPlan(deps: StaffWeekPlanDeps, ctx: TenantContext, weekStart: string): Promise<Result<StaffWeekPlan, DomainError>> {
  const red = gecersiz(weekStart)
  if (red) return Promise.resolve(red)
  const c = dctx(deps, ctx)
  const today = bugun(deps)
  return deps.repo.updateWeekPlan(ctx, weekStart, (current) => decideSubmitWeekPlan(c, current, today))
}

export function approveWeekPlan(deps: StaffWeekPlanDeps, ctx: TenantContext, weekStart: string): Promise<Result<StaffWeekPlan, DomainError>> {
  const red = gecersiz(weekStart)
  if (red) return Promise.resolve(red)
  const c = dctx(deps, ctx)
  const today = bugun(deps)
  return deps.repo.updateWeekPlan(ctx, weekStart, (current) => decideApproveWeekPlan(c, current, today))
}

export function returnWeekPlan(
  deps: StaffWeekPlanDeps,
  ctx: TenantContext,
  weekStart: string,
  reason: string,
): Promise<Result<StaffWeekPlan, DomainError>> {
  const red = gecersiz(weekStart)
  if (red) return Promise.resolve(red)
  const c = dctx(deps, ctx)
  return deps.repo.updateWeekPlan(ctx, weekStart, (current) => decideReturnWeekPlan(c, current, reason))
}

export function loadWeekPlans(
  deps: StaffWeekPlanDeps,
  ctx: TenantContext,
  weekStarts: readonly string[],
): Promise<readonly StaffWeekPlan[]> {
  return deps.repo.getWeekPlans(ctx, weekStarts.filter((w) => TARIH.test(w)))
}
