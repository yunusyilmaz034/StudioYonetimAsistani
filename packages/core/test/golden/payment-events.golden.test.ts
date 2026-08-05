import { describe, expect, it } from 'vitest'

import { decideFulfilIntent } from '../../src/modules/payments/domain/decide'
import type { PaymentIntent } from '../../src/modules/payments/domain/types'
import { instant, money, type CorrelationId, type StaffUserId, type StudioId } from '../../src/shared'
import fulfilled from './payment_intent.fulfilled.v1.json'

// `payment_intent.fulfilled` — the human step between an online payment and a membership
// (owner, 2026-08-05). A NEW event type: nothing existing is touched, no version bump, no upcaster.
//
// The payload is deliberately thin. A public purchase carries the buyer's NAME, PHONE and E-MAIL on
// the intent's context, because until reception acts there is no member record to hold them — and
// none of the three may cross into the log (#6). What the log needs is that the decision happened,
// against which provider reference, and whether the money went to someone already on the books:
// that last flag is what makes "how many online buyers were new customers" answerable later without
// reading a single name.
//
// `memberId` is NOT in the payload either. It is on the state document; the event records the shape
// of the decision, not the subject of it.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist' as const, id: 'usr_desk' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
}

const paidOnlinePurchase = (): PaymentIntent =>
  ({
    id: 'pin_1',
    studioId: 'std_1' as StudioId,
    memberId: 'unattributed',
    saleId: 'sal_1',
    purpose: 'public_membership',
    amount: money(700_000),
    provider: 'paytr',
    flow: 'link',
    providerRef: 'ref_1',
    redirectUrl: null,
    idempotencyKey: 'ref_1',
    status: 'paid',
    context: {
      productId: 'prd_1',
      priceAgreedKurus: 700_000,
      validFrom: '2026-08-06',
      validUntil: '2026-10-05',
      buyerName: 'Ayşe Yılmaz',
      buyerPhone: '+905551112233',
      buyerEmail: 'ayse@example.com',
      note: 'Online üyelik satışı',
    },
    expiresAt: null,
    failureReason: null,
    refundedAmount: money(0),
    createdBy: { type: 'system', id: 'public_page' },
    createdAt: instant(1_699_999_000_000),
    updatedAt: instant(1_699_999_500_000),
  }) as PaymentIntent

describe('payment_intent.fulfilled', () => {
  it('matches the golden payload', () => {
    const r = decideFulfilIntent(ctx, paidOnlinePurchase(), 'mem_9', false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('payment_intent.fulfilled')
    expect(r.value.events[0]?.payload).toEqual(fulfilled)
  })

  it('leaves the buyer name, phone and e-mail out of the log', () => {
    const r = decideFulfilIntent(ctx, paidOnlinePurchase(), 'mem_9', false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const json = JSON.stringify(r.value.events[0]?.payload)
    for (const pii of ['Ayşe', 'Yılmaz', '905551112233', 'ayse@example.com']) {
      expect(json).not.toContain(pii)
    }
  })
})
