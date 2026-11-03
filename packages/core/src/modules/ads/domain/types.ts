import type { ActorRef, Instant, Money, StudioId } from '../../../shared'
import type { AdCaps, AdOrigin } from '../events'

export type AdCampaignStatus = 'draft' | 'approved' | 'publishing' | 'live' | 'failed' | 'removed'

export interface AdTargeting {
  readonly latitude: number
  readonly longitude: number
  readonly radiusKm: number
  readonly ageMin: number
  readonly ageMax: number
  readonly label: string // human description of the place, e.g. "Akse Mah. … Çayırova"
}

export interface AdCreative {
  readonly igMediaId: string // an existing Instagram post (owner, 2026-11-04)
  readonly primaryText: string
}

export interface AdCampaign {
  readonly id: string
  readonly studioId: StudioId
  readonly name: string
  readonly status: AdCampaignStatus
  readonly origin: AdOrigin
  readonly dailyBudget: Money
  readonly startDate: string
  readonly endDate: string
  readonly targeting: AdTargeting
  readonly creative: AdCreative
  readonly rationale: string // why the AI proposed it ('' for the studio's own)
  readonly createdAt: Instant
  readonly createdBy: ActorRef
  readonly approvedAt: Instant | null
  readonly approvedBy: ActorRef | null
  readonly approvedCaps: AdCaps | null
  readonly meta: { readonly campaignId: string; readonly adSetId: string; readonly adId: string } | null
  readonly failure: { readonly stage: string; readonly metaCode: string | null; readonly message: string } | null
}

/** What a human may change while the campaign is still a draft (or failed). */
export type AdCampaignFields = Pick<AdCampaign, 'name' | 'dailyBudget' | 'startDate' | 'endDate' | 'targeting' | 'creative'>
