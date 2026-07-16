import type { Instant, Money, StudioId } from '../../../shared'

// Trainer Payroll & Commission (Plus Phase 9). Earnings are DERIVED from facts the studio already
// records — realised classes (scheduling + attendance) and attributed sales (`Sale.soldBy`) — judged
// against a VERSIONED compensation plan. This module invents no parallel ledger (roadmap Doc 32 §9):
// the only events are the human decisions (set a rate, adjust, finalize, pay).

// The six pay models. `mixed` ("karma") sums every non-zero rate; each other model uses exactly its
// own rate. The model is a label + a validation guide — the arithmetic lives in `compute.ts`.
export type CompensationModel = 'fixed' | 'hourly' | 'per_class' | 'per_member' | 'commission' | 'mixed'

// All rates in integer kuruş except `commissionPercent` (a policy number, 0..100). A rate of 0 means
// "this component does not apply" — a `per_class` plan must set `perClassKurus > 0`.
export interface CompensationRates {
  readonly baseSalaryKurus: number
  readonly hourlyRateKurus: number
  readonly perClassKurus: number
  readonly perMemberKurus: number
  readonly commissionPercent: number
}

// The plan is VERSIONED policy data (roadmap §9 — "a trainer's rate is versioned policy, never an
// `if`"). One plan per trainer (`id === trainerId`); each edit bumps `version`, and every statement
// stamps the snapshot it was judged under (the `productSnapshot` discipline).
export interface CompensationPlan {
  readonly id: string
  readonly studioId: StudioId
  readonly trainerId: string
  readonly version: number
  readonly model: CompensationModel
  readonly rates: CompensationRates
  // Whether a PRESUMED attendance (system_default, AD-38) or a no-show still pays the trainer is a
  // policy decision the roadmap says to settle EXPLICITLY, not stumble into. Both default to false.
  readonly payOnPresumed: boolean
  readonly payOnNoShow: boolean
  readonly note: string
  readonly active: boolean
  readonly updatedAt: Instant
}

// Frozen onto a statement so a finalized period is reproducible even after the plan changes.
export interface CompensationPlanSnapshot {
  readonly planId: string
  readonly version: number
  readonly model: CompensationModel
  readonly rates: CompensationRates
  readonly payOnPresumed: boolean
  readonly payOnNoShow: boolean
}

// ── Pure-computation inputs. The application loads and shapes these; the domain never does I/O. ──

// A class the trainer may be paid for. "Realised" is DERIVED (there is no completed-status in the
// data): a class counts if it was not cancelled and its end is at/behind the as-of instant.
export interface RealisedClassInput {
  readonly sessionId: string
  readonly startsAt: Instant
  readonly endsAt: Instant
  readonly cancelled: boolean
  readonly attendedObserved: number // status 'attended' & attendanceSource 'trainer'
  readonly attendedPresumed: number // status 'attended' & attendanceSource 'system_default'
  readonly noShow: number // status 'no_show'
}

// A sale attributed to the trainer (`Sale.soldBy.id === trainerId`), with the amount OWED (sale.total).
export interface AttributedSaleInput {
  readonly saleId: string
  readonly total: Money
}

export type AdjustmentKind = 'bonus' | 'deduction' | 'correction' | 'advance'

// A manual money line. `amount` is SIGNED (the owner enters a + bonus or a − deduction/advance); the
// note is a business reason and lives on state only — it never enters the event payload (it could
// name a member; PII stays off the log, #6).
export interface Adjustment {
  readonly id: string
  readonly studioId: StudioId
  readonly trainerId: string
  readonly periodKey: string
  readonly kind: AdjustmentKind
  readonly amount: Money
  readonly note: string
  readonly recordedAt: Instant
}

export interface AdjustmentInput {
  readonly adjustmentId: string
  readonly kind: AdjustmentKind
  readonly amount: Money
  readonly note: string
}

// ── The statement: a computed report until the owner FINALIZES it, which freezes the snapshot. ──
export type EarningLineKind = 'base' | 'hourly' | 'per_class' | 'per_member' | 'commission'

export interface EarningLine {
  readonly kind: EarningLineKind
  readonly quantity: number // hours / classes / attendees / sales — DISPLAY metadata, not money
  readonly amount: Money
}

export interface PayrollStatementDraft {
  readonly trainerId: string
  readonly periodStart: Instant
  readonly periodEnd: Instant
  readonly planSnapshot: CompensationPlanSnapshot
  readonly lines: readonly EarningLine[]
  readonly earningsTotal: Money
  readonly adjustmentsTotal: Money
  readonly netPayable: Money
  readonly classCount: number
  readonly attendeeCount: number
  readonly salesTotal: Money
}

export type StatementStatus = 'finalized' | 'paid'

// Persisted only once FINALIZED. A "draft" statement is a pure read (a report), never stored — which
// is what keeps payroll from becoming a second ledger.
export interface PayrollStatement {
  readonly id: string // deterministic: `${trainerId}__${periodKey}`
  readonly studioId: StudioId
  readonly trainerId: string
  readonly periodKey: string
  readonly periodStart: Instant
  readonly periodEnd: Instant
  readonly status: StatementStatus
  readonly planVersion: number
  readonly draft: PayrollStatementDraft
  readonly finalizedAt: Instant
  readonly paidAt: Instant | null
  readonly paidNote: string | null
}
