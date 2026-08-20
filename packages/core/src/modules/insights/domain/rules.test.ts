import { describe, expect, it } from 'vitest'

import { DEFAULT_INSIGHT_CONFIG, deriveInsights, mergeInsightSources, ruleInsightSource } from './rules'
import type { ExpiringFact, InsightFacts } from './types'

const facts = (over: Partial<InsightFacts> = {}): InsightFacts => ({
  expiring: [],
  lowCredit: [],
  balances: [],
  emptySessions: [],
  dormant: [],
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

  it('flags a dormant member by how long she has been away, and stays quiet below the threshold', () => {
    const r = deriveInsights(
      facts({
        dormant: [
          { memberId: 'm1', daysSinceActivity: 40 }, // urgent (>= 35)
          { memberId: 'm2', daysSinceActivity: 25 }, // attention (>= 21)
          { memberId: 'm3', daysSinceActivity: 10 }, // normal — no insight
        ],
      }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ kind: 'dormant_member', severity: 'urgent', suggestedAction: 'contact_member', metrics: { daysSinceActivity: 40 } })
    expect(r[1]).toMatchObject({ kind: 'dormant_member', severity: 'attention' })
    expect(JSON.stringify(r)).not.toMatch(/name|phone/i)
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

// ── PF-41 — the two jobs that sat on the watch list and never became work ────────────────────
describe('credits_exhausted', () => {
  it('raises the renewal conversation while the package is still valid', () => {
    const r = deriveInsights(
      facts({ exhausted: [{ memberId: 'm1', entitlementId: 'e1', daysLeft: 10 }] }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'credits_exhausted', suggestedAction: 'offer_renewal' })
  })

  // Severity runs on TIME, not credits: at zero the credits carry no more information, and the
  // package with two days on it is the one that has to be talked about today.
  it('gets more urgent as the package runs out, not as credits run out', () => {
    const soon = deriveInsights(facts({ exhausted: [{ memberId: 'm1', entitlementId: 'e1', daysLeft: 1 }] }), DEFAULT_INSIGHT_CONFIG)
    const later = deriveInsights(facts({ exhausted: [{ memberId: 'm2', entitlementId: 'e2', daysLeft: 25 }] }), DEFAULT_INSIGHT_CONFIG)
    expect(soon[0]?.severity).toBe('urgent')
    expect(later[0]?.severity).toBe('info')
  })

  it('carries no PII (I-13)', () => {
    const r = deriveInsights(facts({ exhausted: [{ memberId: 'm1', entitlementId: 'e1', daysLeft: 3 }] }), DEFAULT_INSIGHT_CONFIG)
    expect(JSON.stringify(r)).not.toMatch(/name|phone/i)
  })
})

describe('unreconciled_payment', () => {
  it('surfaces money that belongs to nobody', () => {
    const r = deriveInsights(
      facts({ unreconciled: [{ collectionId: 'pcol_1', amountKurus: 420_000, daysOpen: 0 }] }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(r[0]).toMatchObject({
      kind: 'unreconciled_payment',
      severity: 'attention',
      suggestedAction: 'reconcile_payment',
      subject: { type: 'payment', id: 'pcol_1' },
    })
  })

  // Nothing else will ever raise this — nobody complains about a payment they believe they made —
  // so it must escalate on its own rather than wait to be noticed.
  it('ages into urgent on its own', () => {
    const r = deriveInsights(
      facts({ unreconciled: [{ collectionId: 'pcol_1', amountKurus: 420_000, daysOpen: 3 }] }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(r[0]?.severity).toBe('urgent')
  })

  it('carries no buyer name', () => {
    const r = deriveInsights(
      facts({ unreconciled: [{ collectionId: 'pcol_1', amountKurus: 420_000, daysOpen: 5 }] }),
      DEFAULT_INSIGHT_CONFIG,
    )
    expect(JSON.stringify(r)).not.toMatch(/name|buyer/i)
  })
})

// Both fact sets are OPTIONAL, so every caller written before they existed keeps meaning what it
// meant: absent is "not supplied", never "there are none".
describe('the new facts are optional', () => {
  it('produces nothing when they are absent', () => {
    expect(deriveInsights(facts({}), DEFAULT_INSIGHT_CONFIG)).toHaveLength(0)
  })
})

// ── 2026-08-20: "paketin doluyor" ile "hakkın yanacak" ayrıldı ──────────────────────────────
//
// Measured before building: six packages in the studio's whole history expired with credits left,
// and about half the credits in them were lost. The studio keeps the money — what it loses is the
// member, because somebody who paid for sixteen lessons and took six does not renew.
//
// Both lines come from the same clock, so the split has to hold on the ONE thing that separates
// them: whether there is anything left to use.
describe('expiring: with credits vs without', () => {
  const one = (over: Partial<ExpiringFact>) =>
    facts({ expiring: [{ memberId: 'mem_1', entitlementId: 'ent_1', daysLeft: 5, ...over }] })

  it('credits left ⇒ its own kind, and it says how many', () => {
    const [i] = deriveInsights(one({ remainingCredits: 4 }), DEFAULT_INSIGHT_CONFIG)
    expect(i?.kind).toBe('expiring_with_credits')
    expect(i?.metrics.remaining).toBe(4)
    // Not a renewal: there is nothing to sell while she still holds what she paid for.
    expect(i?.suggestedAction).toBe('invite_to_book')
  })

  it('no credits left ⇒ the ordinary renewal line, unchanged', () => {
    const [i] = deriveInsights(one({ remainingCredits: 0 }), DEFAULT_INSIGHT_CONFIG)
    expect(i?.kind).toBe('expiring_soon')
    expect(i?.suggestedAction).toBe('offer_renewal')
  })

  it('a period package has no credits and is never the urgent kind', () => {
    // `null` is not "zero we forgot to read" — an unlimited membership has nothing to burn.
    const [i] = deriveInsights(one({ remainingCredits: null }), DEFAULT_INSIGHT_CONFIG)
    expect(i?.kind).toBe('expiring_soon')
  })

  it('it outranks a plain expiry at the same number of days', () => {
    const both = deriveInsights(
      facts({
        expiring: [
          { memberId: 'mem_a', entitlementId: 'ent_a', daysLeft: 5, remainingCredits: 0 },
          { memberId: 'mem_b', entitlementId: 'ent_b', daysLeft: 5, remainingCredits: 3 },
        ],
      }),
      DEFAULT_INSIGHT_CONFIG,
    )
    // The deadline on the credits cannot be recovered afterwards; the renewal can happen next week.
    expect(both[0]?.kind).toBe('expiring_with_credits')
  })

  it('credits raise a merely-informational expiry to attention', () => {
    const [i] = deriveInsights(one({ daysLeft: 99, remainingCredits: 2 }), DEFAULT_INSIGHT_CONFIG)
    expect(i?.severity).toBe('attention')
  })
})
