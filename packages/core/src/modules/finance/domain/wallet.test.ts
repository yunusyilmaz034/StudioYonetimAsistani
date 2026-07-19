import { describe, expect, it } from 'vitest'

import {
  decideWalletAdjustment,
  decideWalletPurchase,
  decideWalletRefund,
  decideWalletTopup,
  decideWalletVoid,
  type DecideContext,
} from './decide'
import type { Wallet } from './types'
import {
  instant,
  money,
  zeroMoney,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'

// The wallet's one hard invariant (I-37): a debit that would cross zero is REFUSED, never clamped —
// exactly like the credit ledger and the gift card. A wallet cannot go negative, so it cannot lend.

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_owner' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
}

const wallet = (balance: number): Wallet => ({
  id: 'wal_mbr_1',
  studioId: 'std_1' as StudioId,
  memberId: 'mbr_1' as MemberId,
  balance: balance === 0 ? zeroMoney() : money(balance),
  updatedAt: instant(1_699_000_000_000),
})

describe('wallet — money in raises the balance', () => {
  it('topup adds to the balance and stamps balanceAfter', () => {
    const r = decideWalletTopup(ctx, wallet(10000), { amount: money(5000), source: 'cash', paymentId: null, providerRef: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.balance.amount).toBe(15000)
    expect((r.value.events[0]?.payload as { balanceAfter: { amount: number } }).balanceAfter.amount).toBe(15000)
  })

  it('a refund credits the wallet back', () => {
    const r = decideWalletRefund(ctx, wallet(2000), { amount: money(3000), reason: 'iade', originalSaleId: 'sale_9' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.balance.amount).toBe(5000)
  })

  it('refuses a topup of zero or a negative amount', () => {
    expect(decideWalletTopup(ctx, wallet(0), { amount: money(0), source: 'pos', paymentId: null, providerRef: null }).ok).toBe(false)
    expect(decideWalletTopup(ctx, wallet(0), { amount: money(-100), source: 'pos', paymentId: null, providerRef: null }).ok).toBe(false)
  })

  it('refuses a refund with no reason (I-36)', () => {
    expect(decideWalletRefund(ctx, wallet(0), { amount: money(1000), reason: '  ', originalSaleId: null }).ok).toBe(false)
  })
})

describe('wallet — money out is refused below zero (I-37)', () => {
  it('purchase within balance succeeds', () => {
    const r = decideWalletPurchase(ctx, wallet(5000), { amount: money(5000), saleId: 'sale_1', paymentId: 'pay_1' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.balance.amount).toBe(0) // exactly to zero is allowed
  })

  it('purchase of one kuruş more than the balance is REFUSED', () => {
    const r = decideWalletPurchase(ctx, wallet(5000), { amount: money(5001), saleId: 'sale_1', paymentId: 'pay_1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('wallet_insufficient')
  })

  it('a void that exceeds the balance is REFUSED (the money is already spent)', () => {
    const r = decideWalletVoid(ctx, wallet(1000), { amount: money(5000), topupId: 'top_1', reason: 'yanlış yükleme' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('wallet_insufficient')
  })

  it('a debit adjustment below zero is REFUSED', () => {
    const r = decideWalletAdjustment(ctx, wallet(1000), { direction: 'debit', amount: money(2000), reason: 'correction', note: 'düzeltme' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('wallet_insufficient')
  })
})

describe('wallet — a reasoned adjustment (AD-39 shape)', () => {
  it('a credit adjustment needs a note', () => {
    expect(
      decideWalletAdjustment(ctx, wallet(0), { direction: 'credit', amount: money(1000), reason: 'gift', note: '  ' }).ok,
    ).toBe(false)
  })

  it('a credit adjustment with a note raises the balance', () => {
    const r = decideWalletAdjustment(ctx, wallet(0), { direction: 'credit', amount: money(1000), reason: 'gift', note: 'hoş geldin hediyesi' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.balance.amount).toBe(1000)
  })

  it('a debit adjustment within balance succeeds', () => {
    const r = decideWalletAdjustment(ctx, wallet(3000), { direction: 'debit', amount: money(1000), reason: 'support', note: 'manuel düzeltme' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.balance.amount).toBe(2000)
  })
})
