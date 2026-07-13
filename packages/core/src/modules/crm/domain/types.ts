import type { ActorRef, BranchId, Instant, MemberId, Money, StudioId } from '../../../shared'

// ── CRM (v1.24, Doc 26 §8). ─────────────────────────────────────────────────────────────────
//
// A LEAD IS NOT A MEMBER (owner, decision 6). She has no entitlements, no reservations, no portal
// login and no KVKK-consent story; merging the two would put a `status !== 'lead'` filter on every
// member query in the product, forever. Conversion is an EXPLICIT act: `lead.converted` names the
// member it produced, and the lead is closed.
//
// The funnel is the same append-only story as the money, one step earlier:
//   captured → interactions → offer → accepted → SALE (the funnel's only join to finance)
//                                   → rejected / lost (with a reason)

export type LeadSource = 'instagram' | 'walk_in' | 'referral' | 'google' | 'phone' | 'event' | 'other'
export type LeadStage = 'new' | 'contacted' | 'trial' | 'offer' | 'won' | 'lost'

// The enum is what makes a loss ANALYSABLE; the free text is what makes it TRUE. Always both.
export type LostReason =
  | 'price'
  | 'schedule'
  | 'location'
  | 'competitor'
  | 'not_interested'
  | 'unreachable'
  | 'other'

export interface Lead {
  readonly id: string
  readonly studioId: StudioId
  readonly branchId: BranchId | null
  // A lead's identity is PII, and it lives HERE — never in an event (#6).
  readonly fullName: string
  readonly phone: string
  readonly email: string | null
  readonly source: LeadSource // attribution: a lead whose origin was not recorded can never be
  readonly sourceDetail: string | null //           attributed to the campaign that produced it
  readonly stage: LeadStage
  readonly ownerStaffId: string | null // whose lead it is
  readonly createdAt: Instant
  readonly createdBy: ActorRef
  readonly lostReason: LostReason | null
  readonly lostNote: string | null
  readonly convertedMemberId: MemberId | null
  readonly closedAt: Instant | null
  readonly note: string | null
}

export type InteractionKind = 'call' | 'whatsapp' | 'sms' | 'email' | 'meeting' | 'note' | 'trial'

// ONE shape for every interaction. WhatsApp is a KIND, not a module — building a transport here
// would duplicate v1.25 Notification Center badly.
export interface Interaction {
  readonly id: string
  readonly studioId: StudioId
  readonly kind: InteractionKind
  readonly leadId: string | null
  readonly memberId: MemberId | null // CRM notes on an existing member, too
  readonly text: string // the content lives on the aggregate, never in an event (#6)
  readonly at: Instant
  readonly by: ActorRef
  readonly outcome: 'reached' | 'no_answer' | 'callback' | null
}

export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'

export interface OfferLine {
  readonly productId: string | null
  readonly description: string
  readonly quantity: number
  readonly unitPrice: Money
}

export interface Offer {
  readonly id: string
  readonly studioId: StudioId
  readonly leadId: string | null
  readonly memberId: MemberId | null
  readonly lines: readonly OfferLine[]
  readonly total: Money
  readonly validUntil: Instant
  readonly status: OfferStatus
  readonly createdAt: Instant
  readonly createdBy: ActorRef
  readonly rejectedReason: string | null
  readonly saleId: string | null // set when accepted — the funnel's only join to the money
}

// Churn: the same event at the other end of the relationship (Doc 26 §8).
export type ChurnReason =
  | 'price'
  | 'schedule'
  | 'moved_away'
  | 'injury'
  | 'dissatisfied'
  | 'competitor'
  | 'unknown'

export const offerTotal = (lines: readonly OfferLine[]): number =>
  lines.reduce((n, l) => n + l.unitPrice.amount * l.quantity, 0)
