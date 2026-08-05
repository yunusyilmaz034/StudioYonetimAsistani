import { describe, expect, it } from 'vitest'

import {
  instant,
  money,
  type CorrelationId,
  type MemberId,
  type StudioId,
} from '../../../shared'
import { decideCallbackResult, decideFulfilIntent, type DecideContext } from './decide'
import type { PaymentIntent } from './types'

const NOW = instant(1_700_000_000_000)

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'system', id: 'paytr_callback' } as DecideContext['actor'],
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'paytr_callback',
}

const awaiting = (): PaymentIntent =>
  ({
    id: 'pin_1',
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    saleId: 'sal_1',
    purpose: 'package',
    amount: money(1100), // 11,00 ₺ — the single-payment price the studio asked for
    provider: 'paytr',
    flow: 'link',
    providerRef: 'ref_1',
    redirectUrl: null,
    idempotencyKey: 'ref_1',
    status: 'awaiting_payment',
    context: { productId: 'prd_1', priceAgreedKurus: 1100, validFrom: '2026-08-17', validUntil: '2026-09-16', creditOverride: null, note: '' },
    expiresAt: null,
    failureReason: null,
    refundedAmount: money(0),
    createdBy: { type: 'member', id: 'mem_1' },
    createdAt: NOW,
    updatedAt: NOW,
  }) as unknown as PaymentIntent

const settle = (paidKurus: number) =>
  decideCallbackResult(ctx, awaiting(), {
    ok: true,
    providerRef: 'ref_1',
    paidAmount: money(paidKurus),
  })

// ── Instalments (2026-07-27) ─────────────────────────────────────────────────────────────────
//
// A real payment was withheld by this rule on the day self-service checkout shipped. PAYTR adds the
// bank's instalment commission to `total_amount`, so a member who chose three instalments was
// charged MORE than the intent asked for, the amounts differed, and the package was withheld from
// someone whose card had already been debited. Every member picking instalments would have hit it —
// and instalments are an advertised way to pay here.
describe('decideCallbackResult — the paid amount', () => {
  it('GRANTS when she paid more (the bank\'s instalment commission)', () => {
    const r = settle(1210)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.status).toBe('paid')
      expect(r.value.completed).toBe(true)
    }
  })

  // The other direction is NOT the same event: here the studio is owed money, and a silent grant
  // would be giving the package away.
  it('still FLAGS when she paid less', () => {
    const r = settle(900)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.status).toBe('manual_review')
      expect(r.value.next.failureReason).toBe('amount_mismatch')
      expect(r.value.completed).toBe(false)
    }
  })

  it('grants on an exact match, as it always did', () => {
    const r = settle(1100)
    expect(r.ok && r.value.next.status).toBe('paid')
  })

  // A callback for somebody else's intent is never a grant.
  it('refuses a reference that is not ours', () => {
    const r = decideCallbackResult(ctx, awaiting(), { ok: true, providerRef: 'someone_else', paidAmount: money(1100) })
    expect(r.ok).toBe(false)
  })

  // PAYTR retries until it gets "OK"; the second delivery must change nothing.
  it('is idempotent — a replayed callback grants nothing twice', () => {
    const alreadyPaid = { ...awaiting(), status: 'paid' } as PaymentIntent
    const r = decideCallbackResult(ctx, alreadyPaid, { ok: true, providerRef: 'ref_1', paidAmount: money(1100) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.events).toHaveLength(0)
      expect(r.value.completed).toBe(false)
    }
  })
})

// ── ONLINE SATIŞ: the human step between money and membership (owner, 2026-08-05) ────────────
//
// This decision is the only thing standing between a paid public purchase and a SECOND free package.
// Its refusals matter more than its happy path, so they are what is tested hardest here.
describe('decideFulfilIntent — reception turns a paid online purchase into a membership', () => {
  const paid = (over: Partial<PaymentIntent> = {}): PaymentIntent =>
    ({ ...awaiting(), purpose: 'public_membership', status: 'paid', memberId: 'unattributed', ...over }) as PaymentIntent

  const deskCtx: DecideContext = { ...ctx, actor: { type: 'receptionist', id: 'stf_1' } as DecideContext['actor'], source: 'reception_web' }

  it('records who it was attached to, and that a human did it', () => {
    const r = decideFulfilIntent(deskCtx, paid(), 'mem_9', false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.fulfilledMemberId).toBe('mem_9')
    expect(r.value.next.fulfilledAt).toBe(NOW)
    expect(r.value.events).toHaveLength(1)
    expect(r.value.events[0]?.type).toBe('payment_intent.fulfilled')
    expect(r.value.events[0]?.payload).toMatchObject({ providerRef: 'ref_1', purpose: 'public_membership', memberExisted: false })
  })

  it('distinguishes an existing member from a new one — the churn signal depends on it', () => {
    const r = decideFulfilIntent(deskCtx, paid(), 'mem_9', true)
    expect(r.ok && r.value.events[0]?.payload).toMatchObject({ memberExisted: true })
  })

  it('REFUSES a purchase whose money has not arrived', () => {
    for (const status of ['awaiting_payment', 'processing', 'failed', 'expired', 'cancelled'] as const) {
      const r = decideFulfilIntent(deskCtx, paid({ status }), 'mem_9', false)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('payment_not_paid')
    }
  })

  it('REFUSES a second fulfilment — one payment can never grant two packages', () => {
    const first = decideFulfilIntent(deskCtx, paid(), 'mem_9', false)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = decideFulfilIntent(deskCtx, first.value.next, 'mem_9', false)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('payment_already_fulfilled')
  })

  it('REFUSES an empty member — the whole point is that a human chose one', () => {
    const r = decideFulfilIntent(deskCtx, paid(), '   ', false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('member_required')
  })

  it('carries no buyer PII into the event (#6)', () => {
    const withBuyer = paid({
      context: { ...awaiting().context, buyerName: 'Ayşe Yılmaz', buyerPhone: '+905551112233', buyerEmail: 'ayse@example.com' },
    })
    const r = decideFulfilIntent(deskCtx, withBuyer, 'mem_9', false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const json = JSON.stringify(r.value.events[0]?.payload)
    expect(json).not.toContain('Ayşe')
    expect(json).not.toContain('905551112233')
    expect(json).not.toContain('ayse@example.com')
  })
})
