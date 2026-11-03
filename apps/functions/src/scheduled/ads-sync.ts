// The nightly ad-insights pull (IG-4a, 2026-11-03). READ-ONLY against Meta: this job never creates,
// edits, pauses or spends anything (OR-131 — every ad change goes through the owner's approval, and
// this milestone makes none). It reads the studio's ad account and writes ONE summary document.
//
// Which ad account is data: `studios/{sid}/settings/ads.adAccountId` (e.g. 'act_964285176326500').
// No setting → the studio is skipped, loudly. The token is `META_ADS_ACCESS_TOKEN` (a system-user token
// separate from Instagram's on purpose: the DM pipeline must not depend on the ad permissions).
import { allStudioIds } from '@studio/core'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'
import { summarizeInsights, type CampaignRow, type InsightRow } from './ads-insights'

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
