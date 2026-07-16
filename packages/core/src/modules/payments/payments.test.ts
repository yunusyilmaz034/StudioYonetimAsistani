import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { instant, money, type ActorRef, type CorrelationId, type StudioId } from '../../shared'
import { decideCallbackResult, decideRequestRefund, type DecideContext } from './domain/decide'
import type { PaymentIntent } from './domain/types'
import { PaytrProvider, type PaytrConfig } from './infrastructure/paytr-provider'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'system', id: 'pay' } as unknown as ActorRef,
  now: instant(1_800_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'system_payment',
}

const intent = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: 'pin_1',
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1',
  saleId: 'sal_1',
  purpose: 'package',
  amount: money(420_000),
  provider: 'paytr',
  flow: 'pos',
  providerRef: 'oid_1',
  redirectUrl: null,
  idempotencyKey: 'idem_1',
  status: 'awaiting_payment',
  context: { productId: 'prd_1' },
  expiresAt: null,
  failureReason: null,
  refundedAmount: money(0),
  createdBy: ctx.actor,
  createdAt: ctx.now,
  updatedAt: ctx.now,
  ...over,
})

describe('decideCallbackResult — the security core of a payment', () => {
  it('a matching success moves to paid and signals completion (grant now)', () => {
    const r = decideCallbackResult(ctx, intent(), { ok: true, providerRef: 'oid_1', paidAmount: money(420_000) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('paid')
    expect(r.value.completed).toBe(true)
    expect(r.value.events[0]?.type).toBe('payment_intent.succeeded')
  })
  it('is IDEMPOTENT — a replayed callback on an already-paid intent changes nothing and grants nothing', () => {
    const r = decideCallbackResult(ctx, intent({ status: 'paid' }), { ok: true, providerRef: 'oid_1', paidAmount: money(420_000) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events).toEqual([])
    expect(r.value.completed).toBe(false) // NOT a second grant
  })
  it('refuses a provider reference that does not match the intent', () => {
    const r = decideCallbackResult(ctx, intent(), { ok: true, providerRef: 'someone_elses_oid', paidAmount: money(420_000) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('payment_ref_mismatch')
  })
  it('a WRONG amount is a discrepancy → manual_review, never a silent grant', () => {
    const r = decideCallbackResult(ctx, intent(), { ok: true, providerRef: 'oid_1', paidAmount: money(1_000) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('manual_review')
    expect(r.value.completed).toBe(false)
  })
  it('a failed callback moves to failed and grants nothing', () => {
    const r = decideCallbackResult(ctx, intent(), { ok: false, providerRef: 'oid_1', reason: 'declined' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('failed')
    expect(r.value.completed).toBe(false)
  })
})

describe('decideRequestRefund', () => {
  it('refuses over-refund and a non-paid intent', () => {
    expect(decideRequestRefund(ctx, intent({ status: 'awaiting_payment' }), money(1), 'x').ok).toBe(false)
    const over = decideRequestRefund(ctx, intent({ status: 'paid' }), money(999_999), 'iade')
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.error.code).toBe('refund_exceeds_paid')
  })
  it('allows a partial refund within the paid amount', () => {
    const r = decideRequestRefund(ctx, intent({ status: 'paid' }), money(100_000), 'kısmi iade')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.status).toBe('refund_pending')
  })
})

// ── PAYTR adapter — the hash IS the security. A callback we cannot verify is never a grant. ──
const CONFIG: PaytrConfig = { merchantId: 'M1', merchantKey: 'KEY', merchantSalt: 'SALT', testMode: true }

describe('PaytrProvider.verifyCallback', () => {
  const provider = new PaytrProvider(CONFIG)
  const validHash = (oid: string, status: string, total: string) =>
    createHmac('sha256', CONFIG.merchantKey).update(oid + CONFIG.merchantSalt + status + total).digest('base64')

  it('accepts a correctly-hashed success and reports the paid amount in kuruş', () => {
    const v = provider.verifyCallback({ merchant_oid: 'oid_1', status: 'success', total_amount: '420000', hash: validHash('oid_1', 'success', '420000') })
    expect(v.valid).toBe(true)
    expect(v.status).toBe('success')
    expect(v.providerRef).toBe('oid_1')
    expect(v.paidAmount?.amount).toBe(420_000)
  })
  it('REJECTS a tampered hash — the whole point of the callback', () => {
    const v = provider.verifyCallback({ merchant_oid: 'oid_1', status: 'success', total_amount: '999999', hash: validHash('oid_1', 'success', '420000') })
    expect(v.valid).toBe(false)
  })
  it('rejects a missing hash', () => {
    expect(provider.verifyCallback({ merchant_oid: 'oid_1', status: 'success', total_amount: '420000' }).valid).toBe(false)
  })
  it('verifies a failed callback without granting', () => {
    const v = provider.verifyCallback({ merchant_oid: 'oid_1', status: 'failed', total_amount: '0', hash: validHash('oid_1', 'failed', '0'), failed_reason_code: '10' })
    expect(v.valid).toBe(true)
    expect(v.status).toBe('failed')
  })
})
