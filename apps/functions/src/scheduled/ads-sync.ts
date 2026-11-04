// The nightly ad-insights pull (IG-4a, 2026-11-03). READ-ONLY against Meta: this job never creates,
// edits, pauses or spends anything (OR-131 — every ad change goes through the owner's approval, and
// this milestone makes none). It reads the studio's ad account and writes ONE summary document.
//
// Which ad account is data: `studios/{sid}/settings/ads.adAccountId` (e.g. 'act_964285176326500').
// No setting → the studio is skipped, loudly. The token is `META_ADS_ACCESS_TOKEN` (a system-user token
// separate from Instagram's on purpose: the DM pipeline must not depend on the ad permissions).
import { allStudioIds, FirestoreAdsRepository, FirestoreIdentityRepository, money, newCorrelationId, notify, requestAdChange, systemClock, type TenantContext } from '@studio/core'
import { getAuth } from 'firebase-admin/auth'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'
import { notificationDeps, studioNotificationSettings } from '../triggers/on-event-notify'
import { adviseCampaign } from './ads-advisor'
import { driftOf, overspent, summarizeInsights, type AdsSummary, type CampaignRow, type InsightRow } from './ads-insights'

const GRAPH = 'https://graph.facebook.com/v21.0'

async function pageAll<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = []
  let next: string | null = url
  for (let page = 0; next && page < 30; page++) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`meta ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    const body = (await res.json()) as { data?: T[]; paging?: { next?: string } }
    out.push(...(body.data ?? []))
    next = body.paging?.next ?? null
  }
  return out
}

async function studio(studioId: string, token: string, now: number): Promise<void> {
  const database = db()
  const account = String((await database.doc(`studios/${studioId}/settings/ads`).get()).get('adAccountId') ?? '')
  if (!/^act_\d+$/.test(account)) {
    logger.info('ads-sync: no ad account configured', { studioId })
    return
  }
  const meta = (await (await fetch(`${GRAPH}/${account}?fields=currency`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { currency?: string }
  const [campaigns, rows] = await Promise.all([
    pageAll<CampaignRow>(`${GRAPH}/${account}/campaigns?fields=id,name,effective_status&limit=200`, token),
    pageAll<InsightRow>(
      `${GRAPH}/${account}/insights?level=ad&time_increment=1&date_preset=last_90d&limit=500&fields=campaign_id,campaign_name,ad_id,spend,impressions,clicks,actions`,
      token,
    ),
  ])
  const summary = summarizeInsights({ accountId: account, currency: meta.currency ?? 'TRY', syncedAt: now, campaigns, rows })
  await database.doc(`studios/${studioId}/adsInsights/summary`).set(summary)
  logger.info('ads-sync: done', { studioId, campaigns: summary.campaigns.length, rows: rows.length })
  await checkCaps(studioId, summary, now)
  await checkDrift(studioId, token)
  await weeklyAdvice(studioId, summary, now)
}

// IG-5a — the owner approved an amount; if Meta spent more, she hears about it tonight, by e-mail.
async function checkCaps(studioId: string, summary: Parameters<typeof overspent>[0], now: number): Promise<void> {
  const database = db()
  const live = await database.collection(`studios/${studioId}/adCampaigns`).where('status', 'in', ['live', 'paused']).get()
  const approved = live.docs
    .map((d) => d.data() as { name?: string; meta?: { campaignId?: string }; dailyBudget?: { amount?: number }; startDate?: string; endDate?: string })
    .filter((c) => c.meta?.campaignId && c.dailyBudget?.amount && c.startDate && c.endDate)
    .map((c) => {
      const days = Math.round((Date.parse(`${c.endDate}T00:00:00Z`) - Date.parse(`${c.startDate}T00:00:00Z`)) / 86_400_000) + 1
      return { name: String(c.name ?? ''), metaCampaignId: c.meta!.campaignId!, maxSpendKurus: c.dailyBudget!.amount! * days }
    })
  const over = overspent(summary, approved)
  if (over.length === 0) return
  logger.error('ads-sync: OVERSPEND', { studioId, over })
  // IG-5b: the AI also ASKS to pause it — on the owner's card, waiting for her (never applied by itself).
  for (const d of live.docs) {
    const c = d.data() as { name?: string; status?: string }
    if (c.status !== 'live' || !over.some((o) => o.name === String(c.name ?? ''))) continue
    const o = over.find((x) => x.name === String(c.name ?? ''))!
    const r = await requestAdChange(adsDeps(), systemCtx(studioId), d.id, { kind: 'pause' }, `Meta'da harcama ${(o.spentKurus / 100).toLocaleString('tr-TR')} TL, onaylanan en fazla ${(o.maxSpendKurus / 100).toLocaleString('tr-TR')} TL. Durdurmayı öneriyorum.`)
    if (!r.ok) logger.warn('ads-sync: overspend pause request not stored', { studioId, id: d.id, error: r.error })
  }
  const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} TL`
  const lines = over.map((o) => `• ${o.name}: harcanan ${tl(o.spentKurus)} / onaylanan en fazla ${tl(o.maxSpendKurus)}`).join('\n')
  const ctx = { studioId, branchIds: [], role: 'owner', actor: { type: 'system', id: 'ads_sync' } } as unknown as TenantContext
  const owners = (await new FirestoreIdentityRepository(database).listStaff(ctx)).filter((s) => s.active && s.role === 'owner')
  const deps = notificationDeps(await studioNotificationSettings(studioId as TenantContext['studioId']))
  const day = Math.floor((now + 3 * 3_600_000) / 86_400_000)
  for (const owner of owners) {
    let email: string | null = null
    try {
      email = (await getAuth().getUser(owner.id as string)).email ?? null
    } catch {
      /* in-app still reaches her */
    }
    try {
      await notify(deps, ctx, {
        intentId: `ads-overspend-${day}-${owner.id}`,
        eventId: null,
        eventType: 'system.ads_overspend',
        operationId: newCorrelationId(),
        templateId: 'ads_overspend',
        recipient: { kind: 'staff', id: owner.id as string, email, phone: null, displayName: owner.displayName },
        params: { lines },
      })
    } catch (e) {
      logger.warn('ads-sync: overspend notification failed', { studioId, error: (e as Error)?.message })
    }
  }
}

const adsDeps = () => ({ repo: new FirestoreAdsRepository(db()), clock: systemClock })
const systemCtx = (studioId: string) => ({ studioId, branchIds: [], role: 'system', actor: { type: 'system', id: 'ads_advisor' } }) as unknown as TenantContext

// IG-5b — does Meta still hold what the owner approved? Differences go to ONE cache document the
// panel reads (`adsInsights/drift`); nothing is changed on either side.
async function checkDrift(studioId: string, token: string): Promise<void> {
  const database = db()
  const snap = await database.collection(`studios/${studioId}/adCampaigns`).where('status', 'in', ['live', 'paused']).get()
  const byCampaign: Record<string, NonNullable<ReturnType<typeof driftOf>>> = {}
  for (const d of snap.docs) {
    const c = d.data() as { status: 'live' | 'paused'; dailyBudget?: { amount?: number }; endDate?: string; meta?: { campaignId?: string; adSetId?: string } }
    if (!c.meta?.campaignId || !c.meta.adSetId || !c.dailyBudget?.amount || !c.endDate) continue
    try {
      const get = async (id: string, fields: string) =>
        (await (await fetch(`${GRAPH}/${id}?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })).json()) as Record<string, string>
      const [camp, adset] = await Promise.all([get(c.meta.campaignId, 'status'), get(c.meta.adSetId, 'daily_budget,end_time')])
      const drift = driftOf({ status: c.status, dailyBudgetKurus: c.dailyBudget.amount, endDate: c.endDate }, { campaignStatus: camp.status, dailyBudget: adset.daily_budget, endTime: adset.end_time })
      if (drift) byCampaign[d.id] = drift
    } catch (e) {
      logger.warn('ads-sync: drift check failed', { studioId, id: d.id, error: (e as Error)?.message })
    }
  }
  await database.doc(`studios/${studioId}/adsInsights/drift`).set({ byCampaign, checkedAt: Date.now() })
  if (Object.keys(byCampaign).length) logger.warn('ads-sync: DRIFT', { studioId, byCampaign })
}

// IG-5b — Monday night (the Tuesday 03:30 run), the AI looks at each running campaign that has had at
// least 3 days and no pending request, and may ASK for one change. Owner: weekly, not nightly.
async function weeklyAdvice(studioId: string, summary: AdsSummary, now: number): Promise<void> {
  const ist = new Date(now + 3 * 3_600_000)
  if (ist.getUTCDay() !== 2) return
  const today = ist.toISOString().slice(0, 10)
  const database = db()
  const settings = (await database.doc(`studios/${studioId}/settings/ads`).get()).data() ?? {}
  const dailyCap = Number(settings.dailyCapKurus ?? 0)
  const campaignCap = Number(settings.campaignCapKurus ?? 0)
  if (!(dailyCap > 0 && campaignCap > 0)) return
  const totals = new Map(
    summary.campaigns.map((c) => {
      const days = Object.values(c.days)
      const sum = (k: 'spendKurus' | 'impressions' | 'clicks' | 'messages') => days.reduce((n, d) => n + d[k], 0)
      return [c.id, { name: c.name, spend: sum('spendKurus'), impressions: sum('impressions'), clicks: sum('clicks'), messages: sum('messages') }] as const
    }),
  )
  const snap = await database.collection(`studios/${studioId}/adCampaigns`).where('status', '==', 'live').get()
  for (const d of snap.docs) {
    const c = d.data() as { name: string; startDate: string; endDate: string; dailyBudget: { amount: number }; meta?: { campaignId?: string }; pendingChange?: unknown }
    if (c.pendingChange || !c.meta?.campaignId || c.endDate < today) continue
    if (Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${c.startDate}T00:00:00Z`)) / 86_400_000) < 3) continue
    const t = totals.get(c.meta.campaignId) ?? { name: c.name, spend: 0, impressions: 0, clicks: 0, messages: 0 }
    const others = [...totals.entries()]
      .filter(([id]) => id !== c.meta!.campaignId)
      .map(([, o]) => `${o.name}: ${o.spend / 100} TL, ${o.messages} konuşma`)
      .join('; ')
    const a = await adviseCampaign({
      name: c.name,
      startDate: c.startDate,
      endDate: c.endDate,
      today,
      dailyBudgetTl: c.dailyBudget.amount / 100,
      spentTl: t.spend / 100,
      impressions: t.impressions,
      clicks: t.clicks,
      messages: t.messages,
      otherCampaigns: others,
      dailyCapTl: dailyCap / 100,
      campaignCapTl: campaignCap / 100,
    })
    if (a.action === 'none') continue
    const change =
      a.action === 'budget' ? { kind: 'budget' as const, dailyBudget: money(a.dailyBudgetTl * 100) } : a.action === 'end_date' ? { kind: 'end_date' as const, endDate: a.endDate } : { kind: 'pause' as const }
    const r = await requestAdChange(adsDeps(), systemCtx(studioId), d.id, change, a.rationale)
    // Over the cap or otherwise refused → the AI's idea simply does not exist. Logged, never clamped.
    logger.info('ads-advisor', { studioId, id: d.id, action: a.action, stored: r.ok, error: r.ok ? null : r.error })
  }
}

export async function runAdsSync(now: number): Promise<void> {
  const token = process.env.META_ADS_ACCESS_TOKEN
  if (!token) {
    logger.error('ads-sync: META_ADS_ACCESS_TOKEN missing — nothing synced')
    return
  }
  for (const studioId of await allStudioIds(db())) {
    try {
      await studio(String(studioId), token, now)
    } catch (e) {
      // One studio's failure must not stop the rest — and must not be silent either.
      logger.error('ads-sync: failed', { studioId, error: (e as Error)?.message })
    }
  }
}
