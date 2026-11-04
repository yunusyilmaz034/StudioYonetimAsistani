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

// IG-5b (2026-11-04, owner approved these four) — changes to a campaign that is on Meta.
// `change_requested` is the AI asking; the owner's own press needs no request — it is the approval.
// `change_applied` is written only AFTER Meta accepted the change, and stamps who approved it and the
// caps it was judged under. Meta refused → `change_failed`, the campaign keeps its previous state.
export const AD_CAMPAIGN_CHANGE_REQUESTED = 'ad_campaign.change_requested'
export const AD_CAMPAIGN_CHANGE_APPLIED = 'ad_campaign.change_applied'
export const AD_CAMPAIGN_CHANGE_FAILED = 'ad_campaign.change_failed'
export const AD_CAMPAIGN_CHANGE_DISMISSED = 'ad_campaign.change_dismissed'

export type AdChangeKindPayload = 'pause' | 'resume' | 'budget' | 'end_date'

export interface AdCampaignChangeRequestedPayload {
  readonly changeId: string
  readonly kind: AdChangeKindPayload
  readonly origin: AdOrigin
  readonly dailyBudget: Money | null
  readonly endDate: string | null
  readonly maxSpend: Money // what the campaign could spend IF approved
}

export interface AdCampaignChangeAppliedPayload {
  readonly changeId: string
  readonly kind: AdChangeKindPayload
  readonly origin: AdOrigin // 'ai' = an approved AI request; 'staff' = the owner's own press
  readonly from: { readonly status: string; readonly dailyBudget: Money; readonly endDate: string }
  readonly to: { readonly status: string; readonly dailyBudget: Money; readonly endDate: string }
  readonly maxSpend: Money
  readonly caps: AdCaps
}

export interface AdCampaignChangeFailedPayload {
  readonly changeId: string
  readonly kind: AdChangeKindPayload
  readonly origin: AdOrigin
  readonly metaCode: string | null
}

export interface AdCampaignChangeDismissedPayload {
  readonly changeId: string
  readonly kind: AdChangeKindPayload
}
