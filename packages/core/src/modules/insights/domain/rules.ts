import type {
  Insight,
  InsightConfig,
  InsightFacts,
  InsightSeverity,
  InsightSource,
} from './types'

// Sensible starting thresholds. DATA, not literals baked into the rules — a studio may tune them, and
// a future settings screen writes over this seed the same way the notification limits do.
export const DEFAULT_INSIGHT_CONFIG: InsightConfig = {
  balanceUrgentDays: 14,
  balanceAttentionDays: 7,
  expiringUrgentDays: 2,
  expiringAttentionDays: 7,
  lowCreditAttentionAtOrBelow: 1,
  emptySessionAttentionHours: 24,
  // A member with an active package who has not come in three weeks is cooling; five weeks is a
  // serious risk of a quiet, unannounced churn — the exact thing the studio can still act on.
  dormantAttentionDays: 21,
  dormantUrgentDays: 35,
}

const band = (value: number, urgentAt: number, attentionAt: number): InsightSeverity =>
  value >= urgentAt ? 'urgent' : value >= attentionAt ? 'attention' : 'info'

// The deterministic rule source. PURE: the same facts always produce the same ranked insights, so the
// advisor is exhaustively testable (unlike an LLM — which is exactly why L1 is rules, and the LLM
// arrives later behind the same `InsightSource` seam).
export function deriveInsights(facts: InsightFacts, config: InsightConfig): readonly Insight[] {
  const out: Insight[] = []

  for (const b of facts.balances) {
    if (b.dueKurus <= 0) continue
    out.push({
      id: `outstanding_balance__${b.memberId}__${b.saleId}`,
      kind: 'outstanding_balance',
      severity: band(b.daysOpen, config.balanceUrgentDays, config.balanceAttentionDays),
      subject: { type: 'member', id: b.memberId },
      refs: { memberId: b.memberId, saleId: b.saleId },
      metrics: { dueKurus: b.dueKurus, daysOpen: b.daysOpen },
      suggestedAction: 'collect_balance',
      urgency: b.daysOpen,
    })
  }

  for (const e of facts.expiring) {
    // Fewer days left is MORE pressing → invert for both the band and the rank.
    const severity: InsightSeverity =
      e.daysLeft <= config.expiringUrgentDays ? 'urgent' : e.daysLeft <= config.expiringAttentionDays ? 'attention' : 'info'
    out.push({
      id: `expiring_soon__${e.memberId}__${e.entitlementId}`,
      kind: 'expiring_soon',
      severity,
      subject: { type: 'member', id: e.memberId },
      refs: { memberId: e.memberId, entitlementId: e.entitlementId },
      metrics: { daysLeft: e.daysLeft },
      suggestedAction: 'offer_renewal',
      urgency: -e.daysLeft,
    })
  }

  for (const l of facts.lowCredit) {
    out.push({
      id: `low_credit__${l.memberId}__${l.entitlementId}`,
      kind: 'low_credit',
      severity: l.remaining <= config.lowCreditAttentionAtOrBelow ? 'attention' : 'info',
      subject: { type: 'member', id: l.memberId },
      refs: { memberId: l.memberId, entitlementId: l.entitlementId },
      metrics: { remaining: l.remaining },
      suggestedAction: 'offer_renewal',
      urgency: -l.remaining,
    })
  }

  for (const dm of facts.dormant) {
    // Below the attention threshold she is simply a normal member between visits — not news.
    if (dm.daysSinceActivity < config.dormantAttentionDays) continue
    out.push({
      id: `dormant_member__${dm.memberId}`,
      kind: 'dormant_member',
      severity: band(dm.daysSinceActivity, config.dormantUrgentDays, config.dormantAttentionDays),
      subject: { type: 'member', id: dm.memberId },
      refs: { memberId: dm.memberId },
      metrics: { daysSinceActivity: dm.daysSinceActivity },
      suggestedAction: 'contact_member',
      urgency: dm.daysSinceActivity,
    })
  }

  for (const s of facts.emptySessions) {
    const soonAndEmpty = s.hoursAway <= config.emptySessionAttentionHours && s.booked === 0
    out.push({
      id: `empty_session__${s.sessionId}`,
      kind: 'empty_session',
      severity: soonAndEmpty ? 'attention' : 'info',
      subject: { type: 'session', id: s.sessionId },
      refs: { sessionId: s.sessionId },
      metrics: { capacity: s.capacity, booked: s.booked, hoursAway: s.hoursAway },
      suggestedAction: 'fill_session',
      urgency: -s.hoursAway,
    })
  }

  return rankInsights(out)
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { urgent: 0, attention: 1, info: 2 }

// Most-pressing first: urgent before attention before info; within a band, higher urgency, then a
// stable id tie-break so the order is deterministic.
export function rankInsights(insights: readonly Insight[]): readonly Insight[] {
  return [...insights].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.urgency - a.urgency ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

export function ruleInsightSource(): InsightSource {
  return { id: 'rules_l1', generate: (facts, config) => deriveInsights(facts, config) }
}

// Merge many sources into one ranked list (L1 passes only the rule source; the seam is ready for an
// LLM source later). De-dup by insight id so two sources naming the same fact don't double it.
export function mergeInsightSources(
  sources: readonly InsightSource[],
  facts: InsightFacts,
  config: InsightConfig,
): readonly Insight[] {
  const byId = new Map<string, Insight>()
  for (const source of sources) {
    for (const insight of source.generate(facts, config)) {
      if (!byId.has(insight.id)) byId.set(insight.id, insight)
    }
  }
  return rankInsights([...byId.values()])
}
