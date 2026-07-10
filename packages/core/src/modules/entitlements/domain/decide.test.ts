import { describe, expect, it } from 'vitest'

import {
  instant,
  money,
  type EntitlementId,
  type MemberId,
  type PaymentId,
  type ProductId,
  type ReservationId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import type { CorrelationId } from '../../../shared'
import {
  decideAdjust,
  decideCancel,
  decideConsume,
  decideExpire,
  decideHold,
  decidePurchase,
  decideRelease,
  decideRestore,
  type DecideContext,
} from './decide'
import {
  available,
  type CreditLedger,
  type Entitlement,
  type Grant,
  type ProductSnapshot,
} from './types'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const RES = 'res_1' as ReservationId

const CREDIT_GRANT: Grant = { kind: 'credits', credits: 8, validForDays: 30 }
const PERIOD_GRANT: Grant = { kind: 'period', durationDays: 90, access: 'unlimited' }

const snapshot = (grant: Grant): ProductSnapshot => ({
  productId: 'prd_1' as ProductId,
  name: 'Paket',
  category: grant.kind === 'period' ? 'fitness' : 'pilates_group',
  grant,
  listPrice: money(420_000),
})

const ledger = (p: Partial<CreditLedger> = {}): CreditLedger => ({
  granted: 8,
  held: 0,
  consumed: 0,
  restored: 0,
  revoked: 0,
  expired: 0,
  ...p,
})

function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 'ent_1' as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    productId: 'prd_1' as ProductId,
    productSnapshot: snapshot(CREDIT_GRANT),
    policyRef: { policyId: 'pol_1', version: 3 },
    status: 'active',
    validFrom: instant(1_699_000_000_000),
    validUntil: instant(1_800_000_000_000),
    credits: ledger(),
    freeze: null,
    priceAgreed: money(294_000),
    paidTotal: money(0),
    purchasedAt: instant(1_699_000_000_000),
    ...over,
  }
}
const periodEnt = (over: Partial<Entitlement> = {}): Entitlement =>
  ent({ productSnapshot: snapshot(PERIOD_GRANT), credits: null, freeze: null, ...over })

function av(e: Entitlement): number {
  if (!e.credits) throw new Error('expected a credit ledger')
  return available(e.credits)
}

describe('available() (Doc 2 §5.3)', () => {
  it('= granted + restored − consumed − held − revoked − expired', () => {
    expect(available(ledger({ granted: 8, held: 2, consumed: 3, restored: 1, revoked: 1, expired: 1 }))).toBe(2)
  })
})

describe('decidePurchase', () => {
  it('emits entitlement.purchased carrying the policyVersion (I-12)', () => {
    const [e] = decidePurchase(ctx, ent())
    expect(e?.type).toBe('entitlement.purchased')
    expect(e?.policyRef).toEqual({ policyId: 'pol_1', version: 3 })
    expect(e?.payload).toMatchObject({ productId: 'prd_1' })
  })
})

describe('decideHold (E1 — booking holds, available drops)', () => {
  it('holds a credit and reports creditsAvailableAfter', () => {
    const r = decideHold(ctx, ent(), RES)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.credits?.held).toBe(1)
      expect(av(r.value.next)).toBe(7)
      expect(r.value.events[0]?.payload).toEqual({ reservationId: RES, creditsAvailableAfter: 7 })
    }
  })
  it('refuses when available is 0 (I-1, never clamped)', () => {
    const r = decideHold(ctx, ent({ credits: ledger({ held: 8 }) }), RES)
    expect(r).toEqual({ ok: false, error: { code: 'insufficient_credits', available: 0 } })
  })
  it('refuses when the entitlement is not active (I-8)', () => {
    const r = decideHold(ctx, ent({ status: 'frozen' }), RES)
    expect(r).toEqual({ ok: false, error: { code: 'entitlement_not_active' } })
  })
  it('refuses a period entitlement', () => {
    const r = decideHold(ctx, periodEnt(), RES)
    expect(r).toEqual({ ok: false, error: { code: 'not_a_credit_entitlement' } })
  })
})

describe('decideRelease (in-window cancel — no counter moves)', () => {
  it('decrements held only', () => {
    const r = decideRelease(ctx, ent({ credits: ledger({ held: 1 }) }), RES, 'in_window')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.credits).toMatchObject({ held: 0, consumed: 0 })
      expect(av(r.value.next)).toBe(8)
    }
  })
  it('refuses when nothing is held', () => {
    const r = decideRelease(ctx, ent(), RES, 'in_window')
    expect(r).toEqual({ ok: false, error: { code: 'no_held_credit' } })
  })
})

describe('decideConsume (resolution — held→consumed)', () => {
  it('moves held to consumed, available unchanged', () => {
    const r = decideConsume(ctx, ent({ credits: ledger({ held: 1 }) }), RES, 'attended')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.credits).toMatchObject({ held: 0, consumed: 1 })
      expect(av(r.value.next)).toBe(7)
      expect(r.value.events.map((e) => e.type)).toEqual(['entitlement.credit_consumed'])
    }
  })
  it('also emits exhausted when the last credit is consumed', () => {
    const r = decideConsume(ctx, ent({ credits: ledger({ granted: 1, held: 1 }) }), RES, 'attended')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(av(r.value.next)).toBe(0)
      expect(r.value.events.map((e) => e.type)).toEqual(['entitlement.credit_consumed', 'entitlement.exhausted'])
    }
  })
  it('refuses when nothing is held', () => {
    const r = decideConsume(ctx, ent(), RES, 'attended')
    expect(r).toEqual({ ok: false, error: { code: 'no_held_credit' } })
  })
})

describe('decideRestore (correction — consumed stays, restored++, I-3)', () => {
  it('restores without decrementing consumed', () => {
    const r = decideRestore(ctx, ent({ credits: ledger({ consumed: 1 }) }), RES, 'correction')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.credits).toMatchObject({ consumed: 1, restored: 1 })
      expect(av(r.value.next)).toBe(8)
    }
  })
})

describe('decideAdjust (AD-39, I-20)', () => {
  it('a positive delta increments restored', () => {
    const r = decideAdjust(ctx, ent(), 2, 'gift', 'campaign')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.credits).toMatchObject({ restored: 2, revoked: 0 })
      expect(r.value.events[0]?.payload).toMatchObject({ delta: 2, reason: 'gift', note: 'campaign' })
    }
  })
  it('a negative delta increments revoked, never consumed', () => {
    const r = decideAdjust(ctx, ent(), -2, 'correction', 'double sale')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.credits).toMatchObject({ revoked: 2, consumed: 0 })
  })
  it('refuses an empty note', () => {
    expect(decideAdjust(ctx, ent(), 1, 'gift', '  ')).toEqual({ ok: false, error: { code: 'note_required' } })
  })
  it('refuses a zero delta', () => {
    expect(decideAdjust(ctx, ent(), 0, 'gift', 'x')).toEqual({ ok: false, error: { code: 'invalid_adjustment' } })
  })
  it('refuses a decrease below zero (never clamped, I-1)', () => {
    const r = decideAdjust(ctx, ent({ credits: ledger({ granted: 1 }) }), -2, 'correction', 'oops')
    expect(r).toEqual({ ok: false, error: { code: 'insufficient_credits', available: 1 } })
  })
  it('a decrease to exactly zero is allowed (boundary)', () => {
    const r = decideAdjust(ctx, ent({ credits: ledger({ granted: 2 }) }), -2, 'correction', 'ok')
    expect(r.ok).toBe(true)
    if (r.ok) expect(av(r.value.next)).toBe(0)
  })
  it('refuses a period entitlement', () => {
    expect(decideAdjust(ctx, periodEnt(), 1, 'gift', 'x')).toEqual({
      ok: false,
      error: { code: 'not_a_credit_entitlement' },
    })
  })
})

describe('decideExpire (I-4, I-19)', () => {
  it('expires unused credits and marks the entitlement expired', () => {
    const r = decideExpire(ctx, ent({ credits: ledger({ granted: 8, consumed: 3 }) }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.status).toBe('expired')
      expect(av(r.value.next)).toBe(0)
      expect(r.value.events[0]?.payload).toEqual({ grantKind: 'credits', creditsExpired: 5 })
    }
  })
  it('refuses to expire while a credit is held (I-19)', () => {
    const r = decideExpire(ctx, ent({ credits: ledger({ held: 1 }) }))
    expect(r).toEqual({ ok: false, error: { code: 'held_credits_block_expiry', held: 1 } })
  })
  it('expires a period entitlement with zero credits burned', () => {
    const r = decideExpire(ctx, periodEnt())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload).toEqual({ grantKind: 'period', creditsExpired: 0 })
  })
  it('refuses when not active', () => {
    expect(decideExpire(ctx, ent({ status: 'cancelled' }))).toEqual({
      ok: false,
      error: { code: 'entitlement_not_active' },
    })
  })
})

describe('decideCancel', () => {
  it('cancels an active entitlement', () => {
    const r = decideCancel(ctx, ent(), 'refund', 'pay_9' as PaymentId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.next.status).toBe('cancelled')
      expect(r.value.events[0]?.payload).toEqual({ reason: 'refund', refundPaymentId: 'pay_9' })
    }
  })
  it('refuses an empty reason', () => {
    expect(decideCancel(ctx, ent(), '  ', null)).toEqual({ ok: false, error: { code: 'reason_required' } })
  })
  it('refuses an already-expired entitlement', () => {
    expect(decideCancel(ctx, ent({ status: 'expired' }), 'x', null)).toEqual({
      ok: false,
      error: { code: 'entitlement_not_active' },
    })
  })
})
