// Ad campaigns the studio pays for (IG-5a, 2026-11-04). NEW event types — nothing existing is touched.
//
// MONEY + APPROVAL, so the log records exactly what was agreed: the daily budget, the dates, the total it
// may spend, and the CAPS it was judged under (policy is stamped, #4 — the caps are the studio's data, not
// a constant). No free text (ad copy, rationale) and no PII ever enters an event.
import type { Money } from '../../shared'

export const AD_CAMPAIGN_PROPOSED = 'ad_campaign.proposed'
export const AD_CAMPAIGN_EDITED = 'ad_campaign.edited'
export const AD_CAMPAIGN_APPROVED = 'ad_campaign.approved'
export const AD_CAMPAIGN_PUBLISH_STARTED = 'ad_campaign.publish_started'
export const AD_CAMPAIGN_PUBLISHED = 'ad_campaign.published'
export const AD_CAMPAIGN_PUBLISH_FAILED = 'ad_campaign.publish_failed'
export const AD_CAMPAIGN_REMOVED = 'ad_campaign.removed'

export type AdOrigin = 'ai' | 'staff'

export interface AdCaps {
  readonly dailyCap: Money // per day, per campaign
  readonly campaignCap: Money // total a single campaign may spend
}

export interface AdCampaignProposedPayload {
  readonly origin: AdOrigin
  readonly dailyBudget: Money
  readonly startDate: string // 'YYYY-MM-DD', Europe/Istanbul
  readonly endDate: string // inclusive
  readonly days: number
  readonly maxSpend: Money // dailyBudget × days — what the campaign can cost at most
}

export interface AdCampaignEditedPayload {
  readonly changedFields: readonly string[]
  readonly maxSpend: Money
}

export interface AdCampaignApprovedPayload {
  readonly dailyBudget: Money
  readonly startDate: string
  readonly endDate: string
  readonly days: number
  readonly maxSpend: Money
  readonly caps: AdCaps // the caps this approval was judged under
}

export type AdCampaignPublishStartedPayload = Record<string, never>

export interface AdCampaignPublishedPayload {
  readonly metaCampaignId: string
  readonly metaAdSetId: string
  readonly metaAdId: string
}

export interface AdCampaignPublishFailedPayload {
  readonly stage: 'campaign' | 'adset' | 'creative' | 'ad' | 'activate' | 'unknown'
  readonly metaCode: string | null // Meta's error code, no message text
}

export interface AdCampaignRemovedPayload {
  readonly fromStatus: string
}
