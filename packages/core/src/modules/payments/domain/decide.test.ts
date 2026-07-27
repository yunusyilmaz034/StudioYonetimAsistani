import { describe, expect, it } from 'vitest'

import {
  instant,
  money,
  type CorrelationId,
  type MemberId,
  type StudioId,
} from '../../../shared'
import { decideCallbackResult, type DecideContext } from './decide'
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
