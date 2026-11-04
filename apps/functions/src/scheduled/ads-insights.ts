// The nightly ad-insights summary (IG-4a, 2026-11-03) — the PURE half.
//
// Meta's insights rows (one per ad per day) become ONE small document the owner's screen reads in a
// single read: campaigns, their status, which ads belong to them, and per-day spend / impressions /
// clicks / messaging conversations started. It is a CACHE of an external system, not domain state —
// no events, rebuilt from Meta every night (`last_90d`), safe to delete.
//
// Money: Meta sends spend as a decimal STRING in the account currency ("12.34"). It becomes integer
// kuruş by string arithmetic — never through a float (#10).

export interface InsightRow {
  readonly campaign_id?: string
  readonly campaign_name?: string
  readonly ad_id?: string
  readonly date_start?: string
  readonly spend?: string
  readonly impressions?: string
  readonly clicks?: string
  readonly actions?: readonly { action_type?: string; value?: string }[]
}

export interface CampaignRow {
  readonly id?: string
  readonly name?: string
  readonly effective_status?: string
}

export interface DayStats {
  readonly spendKurus: number
  readonly impressions: number
  readonly clicks: number
  readonly messages: number
}

export interface CampaignSummary {
  readonly id: string
  readonly name: string
  readonly status: string // Meta's effective_status: ACTIVE, PAUSED, …
  readonly adIds: readonly string[]
  readonly days: Readonly<Record<string, DayStats>> // 'YYYY-MM-DD' → stats
}

export interface AdsSummary {
  readonly accountId: string
  readonly currency: string
  readonly syncedAt: number
  readonly campaigns: readonly CampaignSummary[]
}

/** "12.34" → 1234, "0.5" → 50, "7" → 700, "" / garbage → 0. String arithmetic only. */
export function decimalToKurus(raw: string | undefined): number {
  const s = (raw ?? '').trim()
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) return 0
  const whole = Number(m[1])
  const frac = (m[2] ?? '').padEnd(3, '0')
  const cents = Number(frac.slice(0, 2))
  const roundUp = Number(frac[2]) >= 5 ? 1 : 0
  return whole * 100 + cents + roundUp
}

const int = (v: string | undefined): number => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const MESSAGE_ACTIONS = new Set(['onsite_conversion.messaging_conversation_started_7d'])

export function summarizeInsights(input: {
  accountId: string
  currency: string
  syncedAt: number
  campaigns: readonly CampaignRow[]
  rows: readonly InsightRow[]
}): AdsSummary {
  const byId = new Map<string, { id: string; name: string; status: string; adIds: Set<string>; days: Map<string, DayStats> }>()
  const ensure = (id: string, name: string) => {
    let c = byId.get(id)
    if (!c) {
      c = { id, name, status: 'UNKNOWN', adIds: new Set(), days: new Map() }
      byId.set(id, c)
    }
    if (name && !c.name) c.name = name
    return c
  }
  for (const c of input.campaigns) {
    if (!c.id) continue
    ensure(c.id, c.name ?? '').status = c.effective_status ?? 'UNKNOWN'
  }
  for (const r of input.rows) {
    if (!r.campaign_id || !r.date_start) continue
    const c = ensure(r.campaign_id, r.campaign_name ?? '')
    if (r.ad_id) c.adIds.add(r.ad_id)
    const prev = c.days.get(r.date_start) ?? { spendKurus: 0, impressions: 0, clicks: 0, messages: 0 }
    const messages = (r.actions ?? []).filter((a) => MESSAGE_ACTIONS.has(a.action_type ?? '')).reduce((n, a) => n + int(a.value), 0)
    c.days.set(r.date_start, {
      spendKurus: prev.spendKurus + decimalToKurus(r.spend),
      impressions: prev.impressions + int(r.impressions),
      clicks: prev.clicks + int(r.clicks),
      messages: prev.messages + messages,
    })
  }
  return {
    accountId: input.accountId,
    currency: input.currency,
    syncedAt: input.syncedAt,
    campaigns: [...byId.values()]
      .map((c) => ({ id: c.id, name: c.name || c.id, status: c.status, adIds: [...c.adIds].sort(), days: Object.fromEntries([...c.days.entries()].sort()) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
  }
}

/**
 * IG-5a — which LIVE campaigns have spent more on Meta than the owner approved? Pure.
 * `approved` = our campaigns with their Meta campaign id and the max spend the owner approved (kuruş).
 * Spend is everything the summary holds for that Meta campaign (the sync covers the last 90 days, and a
 * campaign lasts at most 90).
 */
export function overspent(
  summary: Pick<AdsSummary, 'campaigns'>,
  approved: readonly { name: string; metaCampaignId: string; maxSpendKurus: number }[],
): { name: string; spentKurus: number; maxSpendKurus: number }[] {
  const spentBy = new Map(summary.campaigns.map((c) => [c.id, Object.values(c.days).reduce((n, d) => n + d.spendKurus, 0)]))
  return approved
    .map((a) => ({ name: a.name, spentKurus: spentBy.get(a.metaCampaignId) ?? 0, maxSpendKurus: a.maxSpendKurus }))
    .filter((x) => x.spentKurus > x.maxSpendKurus)
}

/**
 * IG-5b — does Meta still hold what the owner approved? Pure. `ours` = the campaign document;
 * `theirs` = Meta's campaign status, ad-set daily budget (minor unit, as a string) and end time.
 * Only the differences are returned; null = all as approved.
 */
export function driftOf(
  ours: { status: 'live' | 'paused'; dailyBudgetKurus: number; endDate: string },
  theirs: { campaignStatus?: string | undefined; dailyBudget?: string | undefined; endTime?: string | undefined },
): { dailyBudgetKurus: number | null; endDate: string | null; status: string | null } | null {
  const budget = theirs.dailyBudget != null && /^\d+$/.test(theirs.dailyBudget) ? Number(theirs.dailyBudget) : null
  // Meta's end_time is exclusive at 00:00 Istanbul of the day AFTER our last day (what we send).
  const lastDay = theirs.endTime ? metaEndToLastDay(theirs.endTime) : null
  const status = theirs.campaignStatus ?? null
  const d = {
    dailyBudgetKurus: budget != null && budget !== ours.dailyBudgetKurus ? budget : null,
    endDate: lastDay && lastDay !== ours.endDate ? lastDay : null,
    status: status && (status === 'PAUSED') !== (ours.status === 'paused') ? status : null,
  }
  return d.dailyBudgetKurus == null && d.endDate == null && d.status == null ? null : d
}

/** '2026-11-15T00:00:00+0300' → '2026-11-14' (the last day that spends). */
export function metaEndToLastDay(endTime: string): string | null {
  const ms = Date.parse(endTime.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  if (!Number.isFinite(ms)) return null
  return new Date(ms + 3 * 3_600_000 - 1).toISOString().slice(0, 10)
}
