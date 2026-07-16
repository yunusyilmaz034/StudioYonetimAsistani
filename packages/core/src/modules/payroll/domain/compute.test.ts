import { describe, expect, it } from 'vitest'

import { instant, money, type StudioId } from '../../../shared'
import { computeStatement } from './compute'
import type { CompensationPlan, CompensationRates, RealisedClassInput } from './types'

const HOUR = 3_600_000
const t = (h: number) => instant(1_800_000_000_000 + h * HOUR)

const rates = (over: Partial<CompensationRates> = {}): CompensationRates => ({
  baseSalaryKurus: 0,
  hourlyRateKurus: 0,
  perClassKurus: 0,
  perMemberKurus: 0,
  commissionPercent: 0,
  ...over,
})

const plan = (over: Partial<CompensationPlan> = {}): CompensationPlan => ({
  id: 'stf_1',
  studioId: 'std_1' as StudioId,
  trainerId: 'stf_1',
  version: 1,
  model: 'per_class',
  rates: rates(),
  payOnPresumed: false,
  payOnNoShow: false,
  note: '',
  active: true,
  updatedAt: t(0),
  ...over,
})

const klass = (over: Partial<RealisedClassInput> = {}): RealisedClassInput => ({
  sessionId: 'ses_1',
  startsAt: t(1),
  endsAt: t(2), // 1 hour
  cancelled: false,
  attendedObserved: 0,
  attendedPresumed: 0,
  noShow: 0,
  ...over,
})

const period = { periodStart: t(0), periodEnd: t(24 * 30), asOf: t(24 * 30) }

describe('computeStatement — realised is DERIVED from time, not a status flag', () => {
  it('pays per_class only for classes that ended before as-of and were not cancelled', () => {
    const classes = [
      klass({ sessionId: 'a' }),
      klass({ sessionId: 'b', cancelled: true }), // cancelled → excluded
      klass({ sessionId: 'c', startsAt: t(100), endsAt: t(101), cancelled: false }), // ends after asOf? asOf=t(720) so still realised
      klass({ sessionId: 'd', startsAt: t(24 * 40), endsAt: t(24 * 40 + 1) }), // starts after periodEnd → excluded
    ]
    const r = computeStatement({ plan: plan({ model: 'per_class', rates: rates({ perClassKurus: 5000 }) }), ...period, classes, sales: [], adjustments: [] })
    expect(r.classCount).toBe(2) // a and c
    expect(r.earningsTotal.amount).toBe(10_000)
  })
})

describe('computeStatement — the attendance-pay policy is explicit', () => {
  const classes = [klass({ attendedObserved: 3, attendedPresumed: 2, noShow: 1 })]
  it('per_member pays observed attendees only by default', () => {
    const r = computeStatement({ plan: plan({ model: 'per_member', rates: rates({ perMemberKurus: 1000 }) }), ...period, classes, sales: [], adjustments: [] })
    expect(r.attendeeCount).toBe(3)
    expect(r.earningsTotal.amount).toBe(3000)
  })
  it('counts presumed and no-show when the plan opts in', () => {
    const r = computeStatement({
      plan: plan({ model: 'per_member', rates: rates({ perMemberKurus: 1000 }), payOnPresumed: true, payOnNoShow: true }),
      ...period,
      classes,
      sales: [],
      adjustments: [],
    })
    expect(r.attendeeCount).toBe(6) // 3 + 2 + 1
    expect(r.earningsTotal.amount).toBe(6000)
  })
})

describe('computeStatement — commission is a stamped, rounded amount (I-34)', () => {
  it('rounds half up and never re-evaluates the percentage', () => {
    const r = computeStatement({
      plan: plan({ model: 'commission', rates: rates({ commissionPercent: 12.5 }) }),
      ...period,
      classes: [],
      sales: [{ saleId: 's1', total: money(10_001) }], // 12.5% = 1250.125 → 1250
      adjustments: [],
    })
    expect(r.salesTotal.amount).toBe(10_001)
    expect(r.earningsTotal.amount).toBe(1250)
  })
})

describe('computeStatement — mixed sums every non-zero component; adjustments are signed', () => {
  it('adds base (prorated), per_class and commission, then a signed adjustment', () => {
    const r = computeStatement({
      plan: plan({ model: 'mixed', rates: rates({ baseSalaryKurus: 30_000, perClassKurus: 2000, commissionPercent: 10 }) }),
      periodStart: t(0),
      periodEnd: t(24 * 30), // 30 days → full base
      asOf: t(24 * 30),
      classes: [klass({ sessionId: 'a' }), klass({ sessionId: 'b' })],
      sales: [{ saleId: 's', total: money(50_000) }],
      adjustments: [{ adjustmentId: 'adj', kind: 'deduction', amount: money(-1000), note: 'avans' }],
    })
    // base 30000 + per_class 2*2000=4000 + commission 10% of 50000=5000 = 39000
    expect(r.earningsTotal.amount).toBe(39_000)
    expect(r.adjustmentsTotal.amount).toBe(-1000)
    expect(r.netPayable.amount).toBe(38_000)
    expect(r.lines.map((l) => l.kind)).toEqual(['base', 'per_class', 'commission'])
  })
})
