import { describe, expect, it } from 'vitest'

import {
  decideAdjust,
  decideAmend,
  decideCancel,
  decideChargeCancellation,
  decideConsume,
  decideExpire,
  decideHold,
  decidePurchase,
  decideReactivate,
  decideRecordPayment,
  decideRefundCancellation,
  decideRelease,
  decideRestore,
} from '../../src/modules/entitlements/domain/decide'
import type { DecideContext } from '../../src/modules/entitlements/domain/decide'
import type { CreditLedger, Entitlement, Grant } from '../../src/modules/entitlements/domain/types'
import {
  instant,
  money,
  type CorrelationId,
  type EntitlementId,
  type MemberId,
  type PaymentId,
  type ProductId,
  type ReservationId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import adjusted from './entitlement.adjusted.v1.json'
import amended from './entitlement.amended.v1.json'
import cancelled from './entitlement.cancelled.v1.json'
import consumed from './entitlement.credit_consumed.v1.json'
import held from './entitlement.credit_held.v1.json'
import paymentRecorded from './entitlement.payment_recorded.v1.json'
import reactivated from './entitlement.reactivated.v1.json'
import released from './entitlement.credit_released.v1.json'
import restored from './entitlement.credit_restored.v1.json'
import exhausted from './entitlement.exhausted.v1.json'
import expired from './entitlement.expired.v1.json'
import purchased from './entitlement.purchased.v1.json'
import cancellationCharged from './entitlement.cancellation_charged.v1.json'
import cancellationRefunded from './entitlement.cancellation_refunded.v1.json'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const RES = 'res_1' as ReservationId
const GRANT: Grant = { kind: 'credits', credits: 8, validForDays: 30 }
const ledger = (p: Partial<CreditLedger> = {}): CreditLedger => ({
  granted: 8,
  held: 0,
  consumed: 0,
  restored: 0,
  revoked: 0,
  expired: 0,
  ...p,
})
const ent = (credits: CreditLedger = ledger()): Entitlement => ({
  id: 'ent_1' as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1' as MemberId,
  productId: 'prd_1' as ProductId,
  productSnapshot: {
    productId: 'prd_1' as ProductId,
    name: 'Paket',
    category: 'pilates_group',
    grant: GRANT,
    listPrice: money(420_000),
  },
  policyRef: { policyId: 'pol_1', version: 3 },
  status: 'active',
  validFrom: instant(1_699_000_000_000),
  validUntil: instant(1_800_000_000_000),
  credits,
  freeze: null,
  cancellationLedger: { used: 0, refunded: 0 },
  priceAgreed: money(294_000),
  paidTotal: money(0),
  manualPayment: null,
  purchasedAt: instant(1_699_000_000_000),
})

const okEvents = <T extends { ok: boolean }>(r: T): readonly { payload: unknown; type: string }[] => {
  if (!r.ok) throw new Error('expected ok')
  return (r as { value: { events: readonly { payload: unknown; type: string }[] } }).value.events
}

describe('entitlement event payloads match golden fixtures (AD-33)', () => {
  it('entitlement.purchased', () => {
    expect(decidePurchase(ctx, ent())[0]?.payload).toEqual(purchased)
  })
  it('entitlement.credit_held', () => {
    expect(okEvents(decideHold(ctx, ent(), RES))[0]?.payload).toEqual(held)
  })
  it('entitlement.credit_released', () => {
    expect(okEvents(decideRelease(ctx, ent(ledger({ held: 1 })), RES, 'in_window'))[0]?.payload).toEqual(released)
  })
  it('entitlement.credit_consumed', () => {
    expect(okEvents(decideConsume(ctx, ent(ledger({ held: 1 })), RES, 'attended'))[0]?.payload).toEqual(consumed)
  })
  it('entitlement.credit_restored', () => {
    expect(okEvents(decideRestore(ctx, ent(ledger({ consumed: 1 })), RES, 'correction'))[0]?.payload).toEqual(
      restored,
    )
  })
  it('entitlement.adjusted', () => {
    expect(okEvents(decideAdjust(ctx, ent(), 2, 'gift', 'campaign'))[0]?.payload).toEqual(adjusted)
  })
  it('entitlement.exhausted', () => {
    expect(okEvents(decideConsume(ctx, ent(ledger({ granted: 1, held: 1 })), RES, 'attended'))[1]?.payload).toEqual(
      exhausted,
    )
  })
  it('entitlement.expired', () => {
    expect(okEvents(decideExpire(ctx, ent(ledger({ granted: 8, consumed: 3 }))))[0]?.payload).toEqual(expired)
  })
  it('entitlement.cancelled', () => {
    expect(okEvents(decideCancel(ctx, ent(), 'refund', 'pay_9' as PaymentId))[0]?.payload).toEqual(cancelled)
  })
  it('entitlement.payment_recorded', () => {
    const r = decideRecordPayment(ctx, ent(), { collectedAmount: money(200_000), method: 'cash', note: 'Yarısı peşin' })
    expect(okEvents(r)[0]?.payload).toEqual(paymentRecorded)
  })
  it('entitlement.amended', () => {
    const r = decideAmend(ctx, ent(), { priceAgreed: money(250_000) }, 'İndirim uygulandı')
    expect(okEvents(r)[0]?.payload).toEqual(amended)
  })
  it('entitlement.reactivated', () => {
    const r = decideReactivate(ctx, { ...ent(), status: 'cancelled' }, 'Yanlış iptal edildi')
    expect(okEvents(r)[0]?.payload).toEqual(reactivated)
  })
  it('entitlement.cancellation_charged', () => {
    expect(decideChargeCancellation(ctx, ent(), RES).events[0]?.payload).toEqual(cancellationCharged)
  })
  it('entitlement.cancellation_refunded', () => {
    const charged: Entitlement = { ...ent(), cancellationLedger: { used: 1, refunded: 0 } }
    expect(decideRefundCancellation(ctx, charged, RES, 'undo').events[0]?.payload).toEqual(cancellationRefunded)
  })
})
