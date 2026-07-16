import { describe, expect, it } from 'vitest'

import { DEFAULT_INSIGHT_CONFIG, deriveInsights, mergeInsightSources, ruleInsightSource } from './rules'
import type { InsightFacts } from './types'

const facts = (over: Partial<InsightFacts> = {}): InsightFacts => ({
  expiring: [],
  lowCredit: [],
  balances: [],
  emptySessions: [],
  ...over,
})

describe('deriveInsights — deterministic, ranked, PII-free', () => {
  it('classifies a balance by how long it has been open', () => {
    const r = deriveInsights(
      facts({ balances: [{ memberId: 'm1', saleId: 's1', dueKurus: 5000, daysOpen: 20 }] }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'outstanding_balance', severity: 'urgent', suggestedAction: 'collect_balance' })
    expect(JSON.stringify(r[0])).not.toMatch(/name|phone/i) // ids + numbers only
  })

  it('a zero balance produces no insight', () => {
    expect(deriveInsights(facts({ balances: [{ memberId: 'm1', saleId: 's1', dueKurus: 0, daysOpen: 30 }] }), DEFAULT_INSIGHT_CONFIG)).toHaveLength(0)
  })

  it('an expiring package is more urgent the fewer days are left', () => {
    const r = deriveInsights(
      facts({ expiring: [{ memberId: 'm1', entitlementId: 'e1', daysLeft: 1 }, { memberId: 'm2', entitlementId: 'e2', daysLeft: 5 }] }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(r[0]).toMatchObject({ severity: 'urgent', metrics: { daysLeft: 1 } })
    expect(r[1]).toMatchObject({ severity: 'attention', metrics: { daysLeft: 5 } })
  })

  it('ranks urgent before attention before info across kinds', () => {
    const r = deriveInsights(
      facts({
        balances: [{ memberId: 'm1', saleId: 's1', dueKurus: 100, daysOpen: 20 }], // urgent
        lowCredit: [{ memberId: 'm2', entitlementId: 'e2', remaining: 1 }], // attention
        emptySessions: [{ sessionId: 'sess1', capacity: 10, booked: 3, hoursAway: 100 }], // info
      }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(r.map((i) => i.severity)).toEqual(['urgent', 'attention', 'info'])
  })
})

describe('mergeInsightSources — the L2 seam is ready', () => {
  it('the rule source alone yields the ranked list; duplicate ids do not double', () => {
    const f = facts({ balances: [{ memberId: 'm1', saleId: 's1', dueKurus: 100, daysOpen: 3 }] })
    const source = ruleInsightSource()
    const merged = mergeInsightSources([source, source], f, DEFAULT_INSIGHT_CONFIG)
    expect(merged).toHaveLength(1)
  })
})
