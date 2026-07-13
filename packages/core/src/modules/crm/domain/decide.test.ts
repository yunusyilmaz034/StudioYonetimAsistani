import { describe, expect, it } from 'vitest'

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
  type DecideContext,
} from './decide'
import type { Interaction, Lead, Offer } from './types'
import {
  instant,
  money,
  type ActorRef,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'

const NOW = instant(1_700_000_000_000)
const DAY = 86_400_000
const ACTOR: ActorRef = { type: 'receptionist', id: 'usr_1' as StaffUserId }
const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: ACTOR,
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'led_1',
  studioId: 'std_1' as StudioId,
  branchId: null,
  fullName: 'Ayşe Yılmaz',
  phone: '+905551112233',
  email: null,
  source: 'instagram',
  sourceDetail: null,
  stage: 'new',
  ownerStaffId: null,
  createdAt: instant(NOW - 10 * DAY),
  createdBy: ACTOR,
  lostReason: null,
  lostNote: null,
  convertedMemberId: null,
  closedAt: null,
  note: null,
  ...over,
})

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'ofr_1',
  studioId: 'std_1' as StudioId,
  leadId: 'led_1',
  memberId: null,
  lines: [{ productId: 'prd_1', description: 'Reformer 8', quantity: 1, unitPrice: money(500_000) }],
  total: money(500_000),
  validUntil: instant(NOW + 7 * DAY),
  status: 'sent',
  createdAt: instant(NOW - 2 * 3_600_000),
  createdBy: ACTOR,
  rejectedReason: null,
  saleId: null,
  ...over,
})

describe('CRM (v1.24)', () => {
  it('captures a lead WITHOUT putting her name or phone in the log (#6)', () => {
    const r = decideCaptureLead(ctx, lead())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const payload = JSON.stringify(r.value.events[0]?.payload)
    expect(payload).not.toContain('Ayşe')
    expect(payload).not.toContain('905551112233')
    expect(r.value.events[0]?.payload).toEqual({ source: 'instagram', sourceDetail: null })
  })

  it('moves through the funnel, and refuses to move a closed lead', () => {
    const moved = decideMoveStage(ctx, lead(), 'trial')
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.value.events[0]?.payload).toEqual({ from: 'new', to: 'trial' })
    expect(decideMoveStage(ctx, lead({ stage: 'lost' }), 'trial').ok).toBe(false)
  })

  it('a lost lead needs BOTH the enum and the note — the enum makes it analysable, the note true', () => {
    expect(decideLoseLead(ctx, lead(), 'price', '   ').ok).toBe(false)
    const r = decideLoseLead(ctx, lead({ stage: 'offer' }), 'price', 'Rakip 800 TL teklif etmiş')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.stage).toBe('lost')
    expect(r.value.events[0]?.payload).toMatchObject({ reason: 'price', stageWhenLost: 'offer' })
  })

  it('conversion is EXPLICIT: the lead produces a member and closes (owner, decision 6)', () => {
    const r = decideConvertLead(ctx, lead(), 'mem_9' as MemberId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.stage).toBe('won')
    expect(r.value.next.convertedMemberId).toBe('mem_9')
    expect(r.value.events[0]?.payload).toMatchObject({ memberId: 'mem_9', daysToConvert: 10, source: 'instagram' })
    // …and a converted lead cannot be converted twice, or lost afterwards.
    expect(decideConvertLead(ctx, r.value.next, 'mem_9' as MemberId).ok).toBe(false)
    expect(decideLoseLead(ctx, r.value.next, 'price', 'x').ok).toBe(false)
  })

  it('an interaction records its KIND in the log, and keeps its words on the aggregate (#6)', () => {
    const i: Interaction = {
      id: 'int_1',
      studioId: 'std_1' as StudioId,
      kind: 'whatsapp',
      leadId: 'led_1',
      memberId: null,
      text: 'Fiyat sordu, pazartesi deneme dersine gelecek',
      at: NOW,
      by: ACTOR,
      outcome: 'reached',
    }
    const r = decideLogInteraction(ctx, i)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual({ kind: 'whatsapp', outcome: 'reached' })
    expect(JSON.stringify(r.value.events[0]?.payload)).not.toContain('pazartesi')
    expect(decideLogInteraction(ctx, { ...i, text: '  ' }).ok).toBe(false)
  })

  it('an accepted offer produces a SALE — the funnel meets the ledger exactly once', () => {
    const r = decideAcceptOffer(ctx, offer(), 'sal_1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('accepted')
    expect(r.value.next.saleId).toBe('sal_1')
    expect(r.value.events[0]?.payload).toMatchObject({ saleId: 'sal_1', hoursToAccept: 2 })
  })

  it('an expired offer cannot be accepted, and a rejection needs a reason', () => {
    expect(decideAcceptOffer(ctx, offer({ validUntil: instant(NOW - DAY) }), 'sal_1').ok).toBe(false)
    expect(decideRejectOffer(ctx, offer(), '  ').ok).toBe(false)
    expect(decideRejectOffer(ctx, offer(), 'Pahalı buldu').ok).toBe(true)
  })

  it('the offer total is computed, never trusted', () => {
    const r = decideCreateOffer(ctx, offer({ total: money(1), status: 'draft' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.total.amount).toBe(500_000)
  })

  it('churn carries the enum, the note and how long we kept her', () => {
    expect(decideChurn(ctx, 'mem_1' as MemberId, instant(NOW - 200 * DAY), 'price', '  ').ok).toBe(false)
    const r = decideChurn(ctx, 'mem_1' as MemberId, instant(NOW - 200 * DAY), 'competitor', 'Yandaki stüdyoya geçti')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toMatchObject({ reason: 'competitor', membershipDays: 200 })
  })
})
