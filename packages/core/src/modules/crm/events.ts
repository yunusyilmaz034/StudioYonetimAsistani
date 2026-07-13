import type { Instant, MemberId, Money } from '../../shared'
import type { ChurnReason, InteractionKind, LeadSource, LeadStage, LostReason } from './domain/types'

// CRM events. NO PII (#6): a lead's name and phone live in /leads, never in the log. The event says
// a lead was captured, from which SOURCE — which is the part that is analysable, and the part that
// must survive the lead's erasure.

export const LEAD_CAPTURED = 'lead.captured'
export const LEAD_STAGE_CHANGED = 'lead.stage_changed'
export const LEAD_LOST = 'lead.lost'
export const LEAD_CONVERTED = 'lead.converted'
export const INTERACTION_LOGGED = 'interaction.logged'
export const OFFER_CREATED = 'offer.created'
export const OFFER_SENT = 'offer.sent'
export const OFFER_ACCEPTED = 'offer.accepted'
export const OFFER_REJECTED = 'offer.rejected'
export const MEMBER_CHURNED = 'member.churned'

export type LeadCapturedPayload = {
  readonly source: LeadSource
  readonly sourceDetail: string | null
}

export type LeadStageChangedPayload = {
  readonly from: LeadStage
  readonly to: LeadStage
}

export type LeadLostPayload = {
  readonly reason: LostReason
  readonly note: string
  readonly stageWhenLost: LeadStage
}

export type LeadConvertedPayload = {
  readonly memberId: MemberId
  readonly daysToConvert: number // the funnel's only real KPI
  readonly source: LeadSource
}

export type InteractionLoggedPayload = {
  readonly kind: InteractionKind
  readonly outcome: 'reached' | 'no_answer' | 'callback' | null
  // the TEXT is not here — it is the member's or the lead's words, and words are PII-adjacent (#6)
}

export type OfferCreatedPayload = {
  readonly total: Money
  readonly lineCount: number
  readonly validUntil: Instant
}

export type OfferSentPayload = { readonly total: Money }

export type OfferAcceptedPayload = {
  readonly total: Money
  readonly saleId: string
  readonly hoursToAccept: number
}

export type OfferRejectedPayload = {
  readonly total: Money
  readonly reason: string
}

export type MemberChurnedPayload = {
  readonly reason: ChurnReason
  readonly note: string
  readonly membershipDays: number // how long we kept her — the number churn analysis is about
}
