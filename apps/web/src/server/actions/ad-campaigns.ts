'use server'

import {
  addLocalDays,
  approveAndLockAdCampaign,
  editAdCampaign,
  FirestoreAdsRepository,
  localDateAt,
  markAdCampaignFailed,
  markAdCampaignPublished,
  maxSpend,
  money,
  proposeAdCampaign,
  removeAdCampaign,
  systemClock,
  type AdCampaign,
  type AdCampaignFields,
  type DomainError,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { proposeAdIdea } from '../ai/ad-planner'
import { adminDb } from '../firebase-admin'
import { pageLocation, publishCampaign, recentInstagramPosts, type IgPost } from '../meta-ads'

// IG-5a — paid campaigns (owner, 2026-11-04). Draft / edit / remove: the owner (the money is hers to
// plan). APPROVE + PUBLISH: the owner, enforced in the domain as well. Nothing here writes to Meta
// except `approveAndPublishAdCampaignAction`, and that only after the domain took the approval lock.
const OWNER = ['owner', 'platform_admin'] as const

const deps = () => ({ repo: new FirestoreAdsRepository(adminDb()), clock: systemClock })

export type AdResult<T = undefined> = { ok: true; value: T } | { ok: false; error: DomainError | { code: 'ai_unavailable' | 'ads_not_configured' } }

interface AdsSettings {
  adAccountId: string
  pageId: string
  igUserId: string
  dailyCapKurus: number
  campaignCapKurus: number
}

async function settings(sid: string): Promise<AdsSettings | null> {
  const d = (await adminDb().doc(`studios/${sid}/settings/ads`).get()).data() ?? {}
  const s = {
    adAccountId: String(d.adAccountId ?? ''),
    pageId: String(d.pageId ?? ''),
    igUserId: String(d.igUserId ?? ''),
    dailyCapKurus: Number(d.dailyCapKurus ?? 0),
    campaignCapKurus: Number(d.campaignCapKurus ?? 0),
  }
  return /^act_\d+$/.test(s.adAccountId) && s.pageId && s.igUserId && s.dailyCapKurus > 0 && s.campaignCapKurus > 0 ? s : null
}

export interface CampaignsScreen {
  readonly configured: boolean
  readonly dailyCapKurus: number
  readonly campaignCapKurus: number
  readonly campaigns: readonly (AdCampaign & { maxSpendKurus: number })[]
  readonly posts: readonly IgPost[]
}

export async function adCampaignsAction(): Promise<CampaignsScreen> {
  const ctx = await requireTenantContext(OWNER)
  const s = await settings(String(ctx.studioId))
  const [campaigns, posts] = await Promise.all([
    deps().repo.list(ctx),
    s && process.env.INSTAGRAM_ACCESS_TOKEN ? recentInstagramPosts(process.env.INSTAGRAM_ACCESS_TOKEN, s.igUserId) : Promise.resolve([]),
  ])
  return {
    configured: Boolean(s),
    dailyCapKurus: s?.dailyCapKurus ?? 0,
    campaignCapKurus: s?.campaignCapKurus ?? 0,
    campaigns: campaigns.map((c) => ({ ...c, maxSpendKurus: maxSpend(c).amount })),
    posts,
  }
}

/** The AI drafts one campaign. It lands as a DRAFT in the panel; Meta knows nothing of it. */
export async function proposeAdCampaignAction(): Promise<AdResult<{ id: string }>> {
  const ctx = await requireTenantContext(OWNER)
  const sid = String(ctx.studioId)
  const s = await settings(sid)
  const token = process.env.INSTAGRAM_ACCESS_TOKEN
  if (!s || !token) return { ok: false, error: { code: 'ads_not_configured' } }

  const [ai, content, posts, place, summary] = await Promise.all([
    adminDb().doc(`studios/${sid}/settings/ai`).get(),
    adminDb().doc(`studios/${sid}/settings/content`).get(),
    recentInstagramPosts(token, s.igUserId),
    pageLocation(token, s.pageId),
    adminDb().doc(`studios/${sid}/adsInsights/summary`).get(),
  ])
  if (!place || posts.length === 0) return { ok: false, error: { code: 'ads_not_configured' } }
  const spent = ((summary.get('campaigns') as { days?: Record<string, { spendKurus: number; messages: number }> }[] | undefined) ?? [])
    .flatMap((c) => Object.values(c.days ?? {}))
    .reduce((a, d) => ({ spend: a.spend + d.spendKurus, msgs: a.msgs + d.messages }), { spend: 0, msgs: 0 })
  const r = await proposeAdIdea({
    studio: [ai.get('identity'), ai.get('basics'), ai.get('campaign')].filter(Boolean).map(String).join('\n\n').slice(0, 9000),
    areas: ((content.get('areas') as string[] | undefined) ?? []).map(String),
    posts,
    dailyCapTl: s.dailyCapKurus / 100,
    campaignCapTl: s.campaignCapKurus / 100,
    results: spent.spend > 0 ? `${spent.spend / 100} TL harcama, ${spent.msgs} mesaj` : '(henüz reklam verisi yok)',
  })
  if (!r.ok) return { ok: false, error: { code: 'ai_unavailable' } }

  const today = localDateAt(systemClock.now(), 180)
  const start = addLocalDays(today, 1)
  const post = posts.find((p) => p.id === r.idea.igMediaId)!
  const fields: AdCampaignFields = {
    name: r.idea.name,
    dailyBudget: money(Math.round(r.idea.dailyBudgetTl) * 100),
    startDate: start,
    endDate: addLocalDays(start, Math.max(1, Math.round(r.idea.days)) - 1),
    targeting: { latitude: place.latitude, longitude: place.longitude, radiusKm: Math.round(r.idea.radiusKm), ageMin: Math.round(r.idea.ageMin), ageMax: Math.round(r.idea.ageMax), label: place.label },
    // An existing post is used as it is: its own caption is the ad's text (Meta does not let us change it).
    creative: { igMediaId: post.id, primaryText: post.caption || r.idea.name },
  }
  const saved = await proposeAdCampaign(deps(), ctx, { origin: 'ai', rationale: r.idea.rationale, fields })
  return saved.ok ? { ok: true, value: { id: saved.value.id } } : { ok: false, error: saved.error }
}

const fieldsSchema = z.object({
  name: z.string().max(200),
  dailyBudgetKurus: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  radiusKm: z.number().int(),
  ageMin: z.number().int(),
  ageMax: z.number().int(),
  igMediaId: z.string().max(40),
})

export async function editAdCampaignAction(input: unknown): Promise<AdResult> {
  const p = z.object({ id: z.string().regex(/^adc_[0-9A-Z]{26}$/), fields: fieldsSchema }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const s = await settings(String(ctx.studioId))
  const token = process.env.INSTAGRAM_ACCESS_TOKEN
  const current = await deps().repo.get(ctx, p.id)
  if (!s || !token || !current) return { ok: false, error: { code: 'ads_not_configured' } }
  const post = (await recentInstagramPosts(token, s.igUserId, 25)).find((x) => x.id === p.fields.igMediaId)
  const r = await editAdCampaign(deps(), ctx, p.id, {
    name: p.fields.name,
    dailyBudget: money(p.fields.dailyBudgetKurus),
    startDate: p.fields.startDate,
    endDate: p.fields.endDate,
    targeting: { ...current.targeting, radiusKm: p.fields.radiusKm, ageMin: p.fields.ageMin, ageMax: p.fields.ageMax },
    creative: { igMediaId: p.fields.igMediaId, primaryText: post?.caption || current.creative.primaryText },
  })
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}

/**
 * THE ONLY META WRITE. 1) the domain approves AND takes the publishing lock, in one transaction;
 * 2) only if that succeeded, the campaign is built on Meta (paused, switched on at the end);
 * 3) the outcome is recorded — live with Meta ids, or failed with the stage and Meta's reason.
 */
export async function approveAndPublishAdCampaignAction(input: unknown): Promise<AdResult<{ status: string; message?: string }>> {
  const p = z.object({ id: z.string().regex(/^adc_[0-9A-Z]{26}$/) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const s = await settings(String(ctx.studioId))
  const token = process.env.META_ADS_ACCESS_TOKEN
  if (!s || !token) return { ok: false, error: { code: 'ads_not_configured' } }
  const d = deps()
  const locked = await approveAndLockAdCampaign(d, ctx, p.id)
  if (!locked.ok) return { ok: false, error: locked.error }

  const r = await publishCampaign({ token, accountId: s.adAccountId, pageId: s.pageId, igUserId: s.igUserId }, locked.value, Date.now())
  if (r.ok) {
    await markAdCampaignPublished(d, ctx, p.id, r.meta)
    return { ok: true, value: { status: 'live' } }
  }
  console.error('[ads-publish] failed', { stage: r.stage, metaCode: r.metaCode })
  await markAdCampaignFailed(d, ctx, p.id, { stage: r.stage, metaCode: r.metaCode, message: r.message })
  return { ok: true, value: { status: 'failed', message: r.message } }
}

export async function removeAdCampaignAction(input: unknown): Promise<AdResult> {
  const p = z.object({ id: z.string().regex(/^adc_[0-9A-Z]{26}$/) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const r = await removeAdCampaign(deps(), ctx, p.id)
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}
