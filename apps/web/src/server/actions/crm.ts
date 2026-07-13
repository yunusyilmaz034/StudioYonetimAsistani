'use server'

import {
  decideAcceptOffer,
  decideCaptureLead,
  decideChurn,
  decideConvertLead,
  decideCreateOffer,
  decideLogInteraction,
  decideLoseLead,
  decideMoveStage,
  decideRejectOffer,
  decideSendOffer,
  FirestoreCrmRepository,
  FirestoreMemberRepository,
  instant,
  money,
  newOperationId,
  systemClock,
  type Interaction,
  type Lead,
  type MemberId,
  type Offer,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// CRM. A lead is NOT a member (owner, decision 6): conversion is an explicit act that produces a
// member and closes the lead. Nothing here writes to the member's ledger.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const nonEmpty = z.string().min(1)
const repo = () => new FirestoreCrmRepository(adminDb())
const dctx = (ctx: Awaited<ReturnType<typeof requireTenantContext>>) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: systemClock.now(),
  correlationId: newOperationId(),
  source: 'reception_web' as const,
})

export async function captureLeadAction(input: unknown) {
  const p = z
    .object({
      fullName: nonEmpty,
      phone: nonEmpty,
      email: z.string().nullable().default(null),
      source: z.enum(['instagram', 'walk_in', 'referral', 'google', 'phone', 'event', 'other']),
      sourceDetail: z.string().nullable().default(null),
      note: z.string().nullable().default(null),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const c = dctx(ctx)

  const lead: Lead = {
    id: `led_${c.correlationId.slice(4)}`,
    studioId: ctx.studioId,
    branchId: null,
    fullName: p.fullName,
    phone: p.phone,
    email: p.email,
    source: p.source,
    sourceDetail: p.sourceDetail,
    stage: 'new',
    ownerStaffId: ctx.actor.id,
    createdAt: c.now,
    createdBy: ctx.actor,
    lostReason: null,
    lostNote: null,
    convertedMemberId: null,
    closedAt: null,
    note: p.note,
  }
  const decided = decideCaptureLead(c, lead)
  if (!decided.ok) return decided
  await repo().saveLead(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: { leadId: lead.id } }
}

export async function listLeadsAction() {
  const ctx = await requireTenantContext(OPS)
  const leads = await repo().listLeads(ctx)
  return leads.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    phone: l.phone,
    source: l.source,
    stage: l.stage,
    createdAt: l.createdAt as number,
    lostReason: l.lostReason,
    convertedMemberId: l.convertedMemberId as string | null,
    note: l.note,
  }))
}

export async function moveLeadAction(input: unknown) {
  const p = z
    .object({ leadId: nonEmpty, stage: z.enum(['new', 'contacted', 'trial', 'offer']) })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const lead = await repo().getLead(ctx, p.leadId)
  if (!lead) return { ok: false as const, error: { code: 'lead_not_open' as const } }

  const decided = decideMoveStage(dctx(ctx), lead, p.stage)
  if (!decided.ok) return decided
  await repo().saveLead(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: undefined }
}

export async function loseLeadAction(input: unknown) {
  const p = z
    .object({
      leadId: nonEmpty,
      reason: z.enum(['price', 'schedule', 'location', 'competitor', 'not_interested', 'unreachable', 'other']),
      note: nonEmpty, // the enum makes it analysable; the note makes it true
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const lead = await repo().getLead(ctx, p.leadId)
  if (!lead) return { ok: false as const, error: { code: 'lead_not_open' as const } }

  const decided = decideLoseLead(dctx(ctx), lead, p.reason, p.note)
  if (!decided.ok) return decided
  await repo().saveLead(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: undefined }
}

// Conversion is explicit: the lead produces a member, then closes. The member is created by the
// members module — this only records the join.
export async function convertLeadAction(input: unknown) {
  const p = z.object({ leadId: nonEmpty, memberId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const lead = await repo().getLead(ctx, p.leadId)
  if (!lead) return { ok: false as const, error: { code: 'lead_not_open' as const } }

  const decided = decideConvertLead(dctx(ctx), lead, p.memberId as MemberId)
  if (!decided.ok) return decided
  await repo().saveLead(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: undefined }
}

export async function logInteractionAction(input: unknown) {
  const p = z
    .object({
      kind: z.enum(['call', 'whatsapp', 'sms', 'email', 'meeting', 'note', 'trial']),
      leadId: z.string().nullable().default(null),
      memberId: z.string().nullable().default(null),
      text: nonEmpty,
      outcome: z.enum(['reached', 'no_answer', 'callback']).nullable().default(null),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const c = dctx(ctx)

  const interaction: Interaction = {
    id: `int_${c.correlationId.slice(4)}`,
    studioId: ctx.studioId,
    kind: p.kind,
    leadId: p.leadId,
    memberId: (p.memberId ?? null) as MemberId | null,
    text: p.text, // stays on the aggregate — what a member said is hers, and the log is forever (#6)
    at: c.now,
    by: ctx.actor,
    outcome: p.outcome,
  }
  const decided = decideLogInteraction(c, interaction)
  if (!decided.ok) return decided
  await repo().saveInteraction(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: undefined }
}

export async function listInteractionsAction(input: unknown) {
  const p = z
    .object({ leadId: z.string().optional(), memberId: z.string().optional() })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const rows = await repo().listInteractions(ctx, {
    ...(p.leadId ? { leadId: p.leadId } : {}),
    ...(p.memberId ? { memberId: p.memberId as MemberId } : {}),
  })
  return rows.map((i) => ({
    id: i.id,
    kind: i.kind,
    text: i.text,
    at: i.at as number,
    outcome: i.outcome,
    byType: i.by.type,
  }))
}

export async function createOfferAction(input: unknown) {
  const p = z
    .object({
      leadId: z.string().nullable().default(null),
      memberId: z.string().nullable().default(null),
      lines: z
        .array(
          z.object({
            productId: z.string().nullable().default(null),
            description: nonEmpty,
            quantity: z.number().int().min(1),
            unitPriceKurus: z.number().int().min(0),
          }),
        )
        .min(1),
      validDays: z.number().int().min(1).max(90).default(7),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const c = dctx(ctx)

  const offer: Offer = {
    id: `ofr_${c.correlationId.slice(4)}`,
    studioId: ctx.studioId,
    leadId: p.leadId,
    memberId: (p.memberId ?? null) as MemberId | null,
    lines: p.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: money(l.unitPriceKurus),
    })),
    total: money(0), // computed by the decider — never trusted from the client
    validUntil: instant(c.now + p.validDays * 86_400_000),
    status: 'draft',
    createdAt: c.now,
    createdBy: ctx.actor,
    rejectedReason: null,
    saleId: null,
  }
  const decided = decideCreateOffer(c, offer)
  if (!decided.ok) return decided
  await repo().saveOffer(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: { offerId: offer.id } }
}

export async function sendOfferAction(input: unknown) {
  const p = z.object({ offerId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const offer = await repo().getOffer(ctx, p.offerId)
  if (!offer) return { ok: false as const, error: { code: 'operation_not_applicable' as const } }
  const decided = decideSendOffer(dctx(ctx), offer)
  if (!decided.ok) return decided
  await repo().saveOffer(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: undefined }
}

// Accepting an offer produces a SALE. The sale is created by the finance action; this records the
// join — the funnel and the ledger meet exactly once, explicitly.
export async function acceptOfferAction(input: unknown) {
  const p = z.object({ offerId: nonEmpty, saleId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const offer = await repo().getOffer(ctx, p.offerId)
  if (!offer) return { ok: false as const, error: { code: 'operation_not_applicable' as const } }
  const decided = decideAcceptOffer(dctx(ctx), offer, p.saleId)
  if (!decided.ok) return decided
  await repo().saveOffer(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: undefined }
}

export async function rejectOfferAction(input: unknown) {
  const p = z.object({ offerId: nonEmpty, reason: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const offer = await repo().getOffer(ctx, p.offerId)
  if (!offer) return { ok: false as const, error: { code: 'operation_not_applicable' as const } }
  const decided = decideRejectOffer(dctx(ctx), offer, p.reason)
  if (!decided.ok) return decided
  await repo().saveOffer(ctx, decided.value.next, decided.value.events)
  return { ok: true as const, value: undefined }
}

export async function listOffersAction(input: unknown) {
  const p = z.object({ leadId: z.string().optional(), memberId: z.string().optional() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const rows = await repo().listOffers(ctx, {
    ...(p.leadId ? { leadId: p.leadId } : {}),
    ...(p.memberId ? { memberId: p.memberId as MemberId } : {}),
  })
  return rows.map((o) => ({
    id: o.id,
    total: o.total.amount,
    status: o.status,
    validUntil: o.validUntil as number,
    createdAt: o.createdAt as number,
    lines: o.lines.map((l) => l.description),
  }))
}

// Churn: the enum makes it analysable, the note makes it true.
export async function recordChurnAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      reason: z.enum(['price', 'schedule', 'moved_away', 'injury', 'dissatisfied', 'competitor', 'unknown']),
      note: nonEmpty,
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, p.memberId as MemberId)
  if (!member) return { ok: false as const, error: { code: 'member_not_active' as const } }

  const decided = decideChurn(dctx(ctx), member.id, member.joinedAt, p.reason, p.note)
  if (!decided.ok) return decided
  await repo().recordChurn(ctx, member.id, decided.value.events)
  return { ok: true as const, value: undefined }
}
