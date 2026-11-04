import type { ActorRef, Instant, Money, StudioId } from '../../../shared'
import type { AdCaps, AdOrigin } from '../events'

export type AdCampaignStatus = 'draft' | 'approved' | 'publishing' | 'live' | 'paused' | 'failed' | 'removed'

/** IG-5b — a change to a campaign that is on Meta. */
export type AdChangeKind = 'pause' | 'resume' | 'budget' | 'end_date'

/** A change the AI asked for, waiting for the owner. At most one per campaign. */
export interface AdChangeRequest {
  readonly id: string
  readonly kind: AdChangeKind
  readonly dailyBudget: Money | null // budget only
  readonly endDate: string | null // end_date only
  readonly rationale: string
  readonly requestedAt: Instant
  readonly requestedBy: ActorRef
}

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
  /** IG-5b: the AI's pending request (owner approves or dismisses). Absent on IG-5a documents. */
  readonly pendingChange?: AdChangeRequest | null
  /** IG-5b: the last change Meta refused — shown on the card; the campaign kept its previous state. */
  readonly lastChangeFailure?: { readonly kind: AdChangeKind; readonly metaCode: string | null; readonly message: string; readonly at: Instant } | null
  /** IG-5b: who paused it and when (for "Sahibi durdurdu · 11 Kasım 09:14"). */
  readonly pausedAt?: Instant | null
  readonly pausedBy?: ActorRef | null
}

/** What a human may change while the campaign is still a draft (or failed). */
export type AdCampaignFields = Pick<AdCampaign, 'name' | 'dailyBudget' | 'startDate' | 'endDate' | 'targeting' | 'creative'>
