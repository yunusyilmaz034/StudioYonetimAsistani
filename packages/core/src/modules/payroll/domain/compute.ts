import { addMoney, money, zeroMoney, type Instant, type Money } from '../../../shared'
import type {
  AdjustmentInput,
  AttributedSaleInput,
  CompensationModel,
  CompensationPlan,
  CompensationPlanSnapshot,
  EarningLine,
  PayrollStatementDraft,
  RealisedClassInput,
} from './types'

// A trainer's earnings for a period, DERIVED — pure, deterministic, idempotent. It takes facts the
// application already loaded and never touches I/O, a clock, or randomness, so the same period always
// computes the same statement. This is what lets payroll be a REPORT (re-run any time) that only
// becomes a stored fact when the owner finalizes it.

const STANDARD_MONTH_DAYS = 30
const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

// A class is realised (payable) if it was not cancelled, it started inside the period [start, end),
// and it has already ended by the as-of instant. There is no completed-status in the data (AD note),
// so payroll derives "it happened" from time — never from a flag that is never set.
function isRealised(c: RealisedClassInput, periodStart: Instant, periodEnd: Instant, asOf: Instant): boolean {
  return !c.cancelled && c.startsAt >= periodStart && c.startsAt < periodEnd && c.endsAt <= asOf
}

// Commission is a STAMPED amount, computed once with an explicit round-half-up — never a percentage
// re-evaluated later (I-34, the discount discipline). The float is transient; the result is integer kuruş.
function percentOf(amountKurus: number, percent: number): number {
  return Math.round((amountKurus * percent) / 100)
}

export function planSnapshot(plan: CompensationPlan): CompensationPlanSnapshot {
  return {
    planId: plan.id,
    version: plan.version,
    model: plan.model,
    rates: plan.rates,
    payOnPresumed: plan.payOnPresumed,
    payOnNoShow: plan.payOnNoShow,
  }
}

export interface ComputeStatementInput {
  readonly plan: CompensationPlan
  readonly periodStart: Instant
  readonly periodEnd: Instant
  readonly asOf: Instant
  readonly classes: readonly RealisedClassInput[]
  readonly sales: readonly AttributedSaleInput[]
  readonly adjustments: readonly AdjustmentInput[]
}

export function computeStatement(input: ComputeStatementInput): PayrollStatementDraft {
  const { plan, periodStart, periodEnd, asOf, classes, sales, adjustments } = input
  const { rates, model } = plan
  const realised = classes.filter((c) => isRealised(c, periodStart, periodEnd, asOf))

  // `mixed` sums every non-zero rate; any other model contributes only its own component.
  const applies = (m: CompensationModel): boolean => model === m || model === 'mixed'

  // Who pays under this plan's explicit attendance policy: observed attendees always; a presumed
  // attendance only if `payOnPresumed`; a no-show only if `payOnNoShow`.
  const payingAttendees = (c: RealisedClassInput): number =>
    c.attendedObserved + (plan.payOnPresumed ? c.attendedPresumed : 0) + (plan.payOnNoShow ? c.noShow : 0)

  const classCount = realised.length
  const attendeeCount = realised.reduce((n, c) => n + payingAttendees(c), 0)
  const totalMinutes = realised.reduce((n, c) => n + Math.max(0, Math.round((c.endsAt - c.startsAt) / MS_PER_MINUTE)), 0)
  const salesTotal = sales.reduce<Money>((m, s) => addMoney(m, s.total), zeroMoney())

  const lines: EarningLine[] = []

  if (applies('fixed') && rates.baseSalaryKurus > 0) {
    // The base is a MONTHLY figure prorated linearly by the period's length (a 30-day period pays
    // it in full). At least one day, so a same-day custom period still pays something.
    const periodDays = Math.max(1, Math.round((periodEnd - periodStart) / MS_PER_DAY))
    lines.push({ kind: 'base', quantity: periodDays, amount: money(Math.round((rates.baseSalaryKurus * periodDays) / STANDARD_MONTH_DAYS)) })
  }
  if (applies('hourly') && rates.hourlyRateKurus > 0) {
    lines.push({ kind: 'hourly', quantity: totalMinutes / 60, amount: money(Math.round((rates.hourlyRateKurus * totalMinutes) / 60)) })
  }
  if (applies('per_class') && rates.perClassKurus > 0) {
    lines.push({ kind: 'per_class', quantity: classCount, amount: money(rates.perClassKurus * classCount) })
  }
  if (applies('per_member') && rates.perMemberKurus > 0) {
    lines.push({ kind: 'per_member', quantity: attendeeCount, amount: money(rates.perMemberKurus * attendeeCount) })
  }
  if (applies('commission') && rates.commissionPercent > 0) {
    lines.push({ kind: 'commission', quantity: sales.length, amount: money(percentOf(salesTotal.amount, rates.commissionPercent)) })
  }

  const earningsTotal = lines.reduce<Money>((m, l) => addMoney(m, l.amount), zeroMoney())
  const adjustmentsTotal = adjustments.reduce<Money>((m, a) => addMoney(m, a.amount), zeroMoney())
  const netPayable = addMoney(earningsTotal, adjustmentsTotal)

  return {
    trainerId: plan.trainerId,
    periodStart,
    periodEnd,
    planSnapshot: planSnapshot(plan),
    lines,
    earningsTotal,
    adjustmentsTotal,
    netPayable,
    classCount,
    attendeeCount,
    salesTotal,
  }
}
