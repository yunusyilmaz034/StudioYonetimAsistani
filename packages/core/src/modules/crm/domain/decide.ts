import {
  err,
  money,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  INTERACTION_LOGGED,
  LEAD_CAPTURED,
  LEAD_CONVERTED,
  LEAD_LOST,
  LEAD_STAGE_CHANGED,
  MEMBER_CHURNED,
  OFFER_ACCEPTED,
  OFFER_CREATED,
  OFFER_REJECTED,
  OFFER_SENT,
} from '../events'
import { offerTotal, type ChurnReason, type Interaction, type Lead, type LeadStage, type LostReason, type Offer } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

export type Outcome<T> = { readonly next: T; readonly events: readonly NewEvent[] }

const DAY = 86_400_000

const base = (ctx: DecideContext, kind: AggregateKind, id: string, related: Record<string, string> = {}) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind, id },
  related,
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

// The lead's NAME and PHONE never reach the event — only the source, which is the analysable part
// and the part that must survive her erasure (#6).
export function decideCaptureLead(ctx: DecideContext, lead: Lead): Result<Outcome<Lead>, DomainError> {
  if (lead.fullName.trim() === '' || lead.phone.trim() === '') return err({ code: 'invalid_amount' })
  return ok({
    next: lead,
    events: [
      {
        ...base(ctx, 'member', lead.id),
        type: LEAD_CAPTURED,
        payload: { source: lead.source, sourceDetail: lead.sourceDetail },
      },
    ],
  })
}

const OPEN_STAGES: readonly LeadStage[] = ['new', 'contacted', 'trial', 'offer']

export function decideMoveStage(
  ctx: DecideContext,
  lead: Lead,
  to: LeadStage,
): Result<Outcome<Lead>, DomainError> {
  if (!OPEN_STAGES.includes(lead.stage)) return err({ code: 'lead_not_open' })
  if (!OPEN_STAGES.includes(to)) return err({ code: 'lead_not_open' }) // won/lost have their own acts
  if (to === lead.stage) return err({ code: 'operation_not_applicable' })

  const next: Lead = { ...lead, stage: to }
  return ok({
    next,
    events: [
      { ...base(ctx, 'member', lead.id), type: LEAD_STAGE_CHANGED, payload: { from: lead.stage, to } },
    ],
  })
}

// Both, always: the enum makes the loss analysable, the note makes it true.
export function decideLoseLead(
  ctx: DecideContext,
  lead: Lead,
  reason: LostReason,
  note: string,
): Result<Outcome<Lead>, DomainError> {
  if (!OPEN_STAGES.includes(lead.stage)) return err({ code: 'lead_not_open' })
  if (note.trim() === '') return err({ code: 'reason_required' })

  const next: Lead = { ...lead, stage: 'lost', lostReason: reason, lostNote: note, closedAt: ctx.now }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'member', lead.id),
        type: LEAD_LOST,
        payload: { reason, note, stageWhenLost: lead.stage },
      },
    ],
  })
}

// Conversion is EXPLICIT (owner, decision 6). The lead does not *become* a member — it produces one,
// and then closes. Two aggregates, one honest join.
export function decideConvertLead(
  ctx: DecideContext,
  lead: Lead,
  memberId: MemberId,
): Result<Outcome<Lead>, DomainError> {
  if (!OPEN_STAGES.includes(lead.stage)) return err({ code: 'lead_not_open' })

  const next: Lead = { ...lead, stage: 'won', convertedMemberId: memberId, closedAt: ctx.now }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'member', lead.id, { memberId }),
        type: LEAD_CONVERTED,
        payload: {
          memberId,
          daysToConvert: Math.max(0, Math.floor((ctx.now - lead.createdAt) / DAY)),
          source: lead.source,
        },
      },
    ],
  })
}

export function decideLogInteraction(
  ctx: DecideContext,
  interaction: Interaction,
): Result<Outcome<Interaction>, DomainError> {
  if (interaction.text.trim() === '') return err({ code: 'note_required' })
  return ok({
    next: interaction,
    events: [
      {
        ...base(
          ctx,
          'member',
          interaction.id,
          interaction.memberId ? { memberId: interaction.memberId } : {},
        ),
        type: INTERACTION_LOGGED,
        // The TEXT stays on the aggregate. What a member said is hers, and the log is forever.
        payload: { kind: interaction.kind, outcome: interaction.outcome },
      },
    ],
  })
}

// ── Offer — the funnel's only join to the money ─────────────────────────────────────────────
export function decideCreateOffer(ctx: DecideContext, offer: Offer): Result<Outcome<Offer>, DomainError> {
  if (offer.lines.length === 0) return err({ code: 'invalid_amount' })
  const total = money(offerTotal(offer.lines))
  if (total.amount <= 0) return err({ code: 'invalid_amount' })

  const next: Offer = { ...offer, total, status: 'draft' }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payment', offer.id, offer.memberId ? { memberId: offer.memberId } : {}),
        type: OFFER_CREATED,
        payload: { total, lineCount: offer.lines.length, validUntil: offer.validUntil },
      },
    ],
  })
}

export function decideSendOffer(ctx: DecideContext, offer: Offer): Result<Outcome<Offer>, DomainError> {
  if (offer.status !== 'draft') return err({ code: 'operation_not_applicable' })
  const next: Offer = { ...offer, status: 'sent' }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payment', offer.id, offer.memberId ? { memberId: offer.memberId } : {}),
        type: OFFER_SENT,
        payload: { total: offer.total },
      },
    ],
  })
}

// Accepting an offer PRODUCES a sale. The application creates the sale and passes its id here: the
// funnel and the ledger meet exactly once, and they meet explicitly.
export function decideAcceptOffer(
  ctx: DecideContext,
  offer: Offer,
  saleId: string,
): Result<Outcome<Offer>, DomainError> {
  if (offer.status !== 'sent' && offer.status !== 'draft') return err({ code: 'operation_not_applicable' })
  if (offer.validUntil < ctx.now) return err({ code: 'operation_not_applicable' })

  const next: Offer = { ...offer, status: 'accepted', saleId }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payment', offer.id, offer.memberId ? { memberId: offer.memberId } : {}),
        type: OFFER_ACCEPTED,
        payload: {
          total: offer.total,
          saleId,
          hoursToAccept: Math.max(0, Math.floor((ctx.now - offer.createdAt) / 3_600_000)),
        },
      },
    ],
  })
}

export function decideRejectOffer(
  ctx: DecideContext,
  offer: Offer,
  reason: string,
): Result<Outcome<Offer>, DomainError> {
  if (offer.status === 'accepted') return err({ code: 'operation_not_applicable' })
  if (reason.trim() === '') return err({ code: 'reason_required' })

  const next: Offer = { ...offer, status: 'rejected', rejectedReason: reason }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payment', offer.id, offer.memberId ? { memberId: offer.memberId } : {}),
        type: OFFER_REJECTED,
        payload: { total: offer.total, reason },
      },
    ],
  })
}

// Churn: the enum makes it analysable, the note makes it true. Same rule as a lost lead — because it
// is the same question, asked at the other end of the relationship.
export function decideChurn(
  ctx: DecideContext,
  memberId: MemberId,
  joinedAt: Instant,
  reason: ChurnReason,
  note: string,
): Result<Outcome<{ memberId: MemberId }>, DomainError> {
  if (note.trim() === '') return err({ code: 'reason_required' })
  return ok({
    next: { memberId },
    events: [
      {
        ...base(ctx, 'member', memberId, { memberId }),
        type: MEMBER_CHURNED,
        payload: {
          reason,
          note,
          membershipDays: Math.max(0, Math.floor((ctx.now - joinedAt) / DAY)),
        },
      },
    ],
  })
}
