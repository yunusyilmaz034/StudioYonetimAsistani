import { describe, expect, it } from 'vitest'

import { instant, money, type ActorRef, type CorrelationId, type StudioId } from '../../../shared'
import {
  decideFinalizeStatement,
  decidePayStatement,
  decideRecordAdjustment,
  decideSetCompensationPlan,
  type DecideContext,
} from './decide'
import type { CompensationRates, PayrollStatement, PayrollStatementDraft } from './types'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'own_1' } as unknown as ActorRef,
  now: instant(1_800_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const rates = (over: Partial<CompensationRates> = {}): CompensationRates => ({
  baseSalaryKurus: 0,
  hourlyRateKurus: 0,
  perClassKurus: 0,
  perMemberKurus: 0,
  commissionPercent: 0,
  ...over,
})

describe('decideSetCompensationPlan — a rate is versioned policy, validated', () => {
  it('bumps the version on each set and stamps the model', () => {
    const v1 = decideSetCompensationPlan(ctx, null, { trainerId: 'stf_1', model: 'per_class', rates: rates({ perClassKurus: 5000 }), payOnPresumed: false, payOnNoShow: false, note: '' })
    expect(v1.ok).toBe(true)
    if (!v1.ok) return
    expect(v1.value.next.version).toBe(1)
    const v2 = decideSetCompensationPlan(ctx, v1.value.next, { trainerId: 'stf_1', model: 'per_class', rates: rates({ perClassKurus: 6000 }), payOnPresumed: false, payOnNoShow: false, note: '' })
    expect(v2.ok && v2.value.next.version).toBe(2)
  })
  it('refuses a negative rate, a bad commission %, and a model missing its required rate', () => {
    expect(decideSetCompensationPlan(ctx, null, { trainerId: 't', model: 'per_class', rates: rates({ perClassKurus: -1 }), payOnPresumed: false, payOnNoShow: false, note: '' }).ok).toBe(false)
    expect(decideSetCompensationPlan(ctx, null, { trainerId: 't', model: 'commission', rates: rates({ commissionPercent: 150 }), payOnPresumed: false, payOnNoShow: false, note: '' }).ok).toBe(false)
    const missing = decideSetCompensationPlan(ctx, null, { trainerId: 't', model: 'per_class', rates: rates(), payOnPresumed: false, payOnNoShow: false, note: '' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('invalid_compensation_rate')
  })
})

describe('decideRecordAdjustment — signed money, note required, note stays off the event', () => {
  it('records a signed adjustment and keeps the note out of the payload (PII)', () => {
    const r = decideRecordAdjustment(ctx, 'stf_1', '2026-07', { adjustmentId: 'adj_1', kind: 'bonus', amount: money(2500), note: 'iyi ay' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(JSON.stringify(r.value.events[0]?.payload)).not.toContain('iyi ay')
    expect(r.value.events[0]?.payload).toMatchObject({ kind: 'bonus' })
  })
  it('refuses a zero amount and an empty note', () => {
    expect(decideRecordAdjustment(ctx, 't', 'p', { adjustmentId: 'a', kind: 'bonus', amount: money(0), note: 'x' }).ok).toBe(false)
    expect(decideRecordAdjustment(ctx, 't', 'p', { adjustmentId: 'a', kind: 'bonus', amount: money(10), note: '  ' }).ok).toBe(false)
  })
})

const draft: PayrollStatementDraft = {
  trainerId: 'stf_1',
  periodStart: instant(1_000),
  periodEnd: instant(2_000),
  planSnapshot: { planId: 'stf_1', version: 1, model: 'per_class', rates: rates({ perClassKurus: 5000 }), payOnPresumed: false, payOnNoShow: false },
  lines: [],
  earningsTotal: money(10_000),
  adjustmentsTotal: money(0),
  netPayable: money(10_000),
  classCount: 2,
  attendeeCount: 0,
  salesTotal: money(0),
}

describe('decideFinalizeStatement — idempotent; a finalized period is frozen', () => {
  it('finalizes a fresh period and refuses re-finalizing', () => {
    const r = decideFinalizeStatement(ctx, null, { statementId: 'stf_1__2026-07', periodKey: '2026-07', draft, planVersion: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('finalized')
    const again = decideFinalizeStatement(ctx, r.value.next, { statementId: 'stf_1__2026-07', periodKey: '2026-07', draft, planVersion: 1 })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('payroll_already_finalized')
  })
})

describe('decidePayStatement — pay only a finalized statement, once', () => {
  const finalized: PayrollStatement = {
    id: 'stf_1__2026-07', studioId: 'std_1' as StudioId, trainerId: 'stf_1', periodKey: '2026-07',
    periodStart: instant(1_000), periodEnd: instant(2_000), status: 'finalized', planVersion: 1, draft,
    finalizedAt: ctx.now, paidAt: null, paidNote: null,
  }
  it('marks paid then refuses a double pay', () => {
    const r = decidePayStatement(ctx, finalized, money(10_000), 'elden')
    expect(r.ok && r.value.next.status).toBe('paid')
    if (!r.ok) return
    expect(decidePayStatement(ctx, r.value.next, money(10_000), 'x').ok).toBe(false)
  })
})
