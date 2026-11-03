import 'server-only'

import type { AdCampaign } from '@studio/core'

// Meta Marketing API — the ONLY place the panel writes to Meta (IG-5a, 2026-11-04). Called only after the
// domain has taken the `publishing` lock, which it takes only for an owner-approved campaign.
//
// Order, and why: everything is created PAUSED — campaign → ad set → creative → ad — and switched ON only
// at the very end. If any step fails, what was created stays paused (and is paused again, to be sure):
// nothing half-built can spend. The caller records the failure; the approval is spent (invariant 6).
//
// Money: Meta takes budgets in the currency's minor unit. For TRY that is kuruş — the same integer the
// domain holds (#10). No conversion, no float.

const GRAPH = 'https://graph.facebook.com/v21.0'
const IST = '+03:00'

export interface PublishContext {
  readonly token: string // META_ADS_ACCESS_TOKEN (system user, ads_management)
  readonly accountId: string // 'act_…'
  readonly pageId: string
  readonly igUserId: string
}

export type PublishResult =
  | { readonly ok: true; readonly meta: { campaignId: string; adSetId: string; adId: string } }
  | { readonly ok: false; readonly stage: 'campaign' | 'adset' | 'creative' | 'ad' | 'activate' | 'unknown'; readonly metaCode: string | null; readonly message: string }

class MetaError extends Error {
  constructor(
    readonly stage: Exclude<PublishResult, { ok: true }>['stage'],
    readonly metaCode: string | null,
    message: string,
  ) {
    super(message)
  }
}

async function post(ctx: PublishContext, path: string, params: Record<string, unknown>, stage: MetaError['stage']): Promise<{ id: string }> {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) body.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  body.set('access_token', ctx.token)
  const res = await fetch(`${GRAPH}/${path}`, { method: 'POST', body, signal: AbortSignal.timeout(30_000) })
  const data = (await res.json().catch(() => ({}))) as { id?: string; success?: boolean; error?: { code?: number; error_user_msg?: string; message?: string } }
  if (!res.ok || data.error) {
    throw new MetaError(stage, data.error?.code != null ? String(data.error.code) : null, data.error?.error_user_msg || data.error?.message || `HTTP ${res.status}`)
  }
  return { id: data.id ?? '' }
}

/** The ad set's end: Meta's end_time is exclusive, so the day AFTER the last day, 00:00 Istanbul. */
function endTime(endDate: string): string {
  const d = new Date(`${endDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return `${d.toISOString().slice(0, 10)}T00:00:00${IST}`
}

function startTime(startDate: string, now: number): string {
  const startOfDay = Date.parse(`${startDate}T00:00:00${IST}`)
  // Starting today: a few minutes from now (Meta refuses a start in the past).
  return startOfDay > now ? `${startDate}T00:00:00${IST}` : new Date(now + 10 * 60_000).toISOString()
}

export async function publishCampaign(ctx: PublishContext, c: AdCampaign, now: number): Promise<PublishResult> {
  const created: string[] = []
  try {
    const campaign = await post(
      ctx,
      `${ctx.accountId}/campaigns`,
      { name: c.name, objective: 'OUTCOME_ENGAGEMENT', status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION' },
      'campaign',
    )
    created.push(campaign.id)
    const adSet = await post(
      ctx,
      `${ctx.accountId}/adsets`,
      {
        name: `${c.name} · ${c.targeting.radiusKm} km`,
        campaign_id: campaign.id,
        status: 'PAUSED',
        daily_budget: String(c.dailyBudget.amount), // TRY minor unit = kuruş
        start_time: startTime(c.startDate, now),
        end_time: endTime(c.endDate),
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'CONVERSATIONS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        destination_type: 'WHATSAPP',
        promoted_object: { page_id: ctx.pageId },
        targeting: {
          geo_locations: {
            custom_locations: [{ latitude: c.targeting.latitude, longitude: c.targeting.longitude, radius: c.targeting.radiusKm, distance_unit: 'kilometer' }],
            location_types: ['home', 'recent'],
          },
          genders: [2], // women-only studio
          age_min: c.targeting.ageMin,
          age_max: c.targeting.ageMax,
          publisher_platforms: ['facebook', 'instagram'],
          facebook_positions: ['feed', 'story'],
          instagram_positions: ['stream', 'story'],
        },
      },
      'adset',
    )
    created.push(adSet.id)
    const creative = await post(
      ctx,
      `${ctx.accountId}/adcreatives`,
      {
        name: `${c.name} · kreatif`,
        object_id: ctx.pageId,
        instagram_user_id: ctx.igUserId,
        source_instagram_media_id: c.creative.igMediaId,
        call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } },
      },
      'creative',
    )
    const ad = await post(ctx, `${ctx.accountId}/ads`, { name: c.name, adset_id: adSet.id, creative: { creative_id: creative.id }, status: 'PAUSED' }, 'ad')
    created.push(ad.id)
    // Everything exists and is paused. Now — and only now — switch it on, outermost last.
    for (const id of [ad.id, adSet.id, campaign.id]) await post(ctx, id, { status: 'ACTIVE' }, 'activate')
    return { ok: true, meta: { campaignId: campaign.id, adSetId: adSet.id, adId: ad.id } }
  } catch (e) {
    // Pause whatever exists (best effort, in reverse). They were created paused; this is belt and braces
    // for a failure during activation.
    for (const id of created.reverse()) {
      try {
        await post(ctx, id, { status: 'PAUSED' }, 'activate')
      } catch {
        /* logged by the caller via the failure it records */
      }
    }
    if (e instanceof MetaError) return { ok: false, stage: e.stage, metaCode: e.metaCode, message: e.message }
    return { ok: false, stage: 'unknown', metaCode: null, message: (e as Error)?.message ?? 'bilinmeyen hata' }
  }
}

export interface IgPost {
  readonly id: string
  readonly caption: string
  readonly mediaType: string
  readonly thumbnail: string | null
  readonly permalink: string
  readonly timestamp: string
}

/** The studio's recent Instagram posts — the creative is one of these (owner, 2026-11-04). */
export async function recentInstagramPosts(token: string, igUserId: string, limit = 12): Promise<IgPost[]> {
  const url = `${GRAPH}/${igUserId}/media?fields=id,caption,media_type,thumbnail_url,media_url,permalink,timestamp&limit=${limit}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return []
  const d = (await res.json().catch(() => ({}))) as { data?: { id: string; caption?: string; media_type?: string; thumbnail_url?: string; media_url?: string; permalink?: string; timestamp?: string }[] }
  return (d.data ?? []).map((m) => ({
    id: m.id,
    caption: (m.caption ?? '').slice(0, 2200),
    mediaType: m.media_type ?? '',
    thumbnail: m.thumbnail_url ?? (m.media_type === 'IMAGE' ? (m.media_url ?? null) : null),
    permalink: m.permalink ?? '',
    timestamp: m.timestamp ?? '',
  }))
}

/** The studio's location as Meta has it on the Page (so the ad targets what Meta itself knows). */
export async function pageLocation(token: string, pageId: string): Promise<{ latitude: number; longitude: number; label: string } | null> {
  const res = await fetch(`${GRAPH}/${pageId}?fields=location,single_line_address`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const d = (await res.json().catch(() => ({}))) as { location?: { latitude?: number; longitude?: number; street?: string; city?: string }; single_line_address?: string }
  if (typeof d.location?.latitude !== 'number' || typeof d.location?.longitude !== 'number') return null
  return { latitude: d.location.latitude, longitude: d.location.longitude, label: d.single_line_address || [d.location.street, d.location.city].filter(Boolean).join(', ') }
}
