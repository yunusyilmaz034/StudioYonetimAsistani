import { describe, expect, it } from 'vitest'

import { decideWalletPurchase, decideWalletTopup } from '../../src/modules/finance/domain/decide'
import type { Wallet } from '../../src/modules/finance/domain/types'
import {
  instant,
  money,
  zeroMoney,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import walletTopup from './wallet.topup.v1.json'
import walletPurchase from './wallet.purchase.v1.json'

// Member wallet (Doc 27, v1.27). NO PII (#6): the wallet is an id, the member is an id, the money is
// integer kuruş. `balanceAfter` on every payload is what lets the log alone reconstruct the balance —
// no projector reads the wallet state to know it.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_owner' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
}

const wallet = (balance = 0): Wallet => ({
  id: 'wal_mbr_1',
  studioId: 'std_1' as StudioId,
  memberId: 'mbr_1' as MemberId,
  balance: balance === 0 ? zeroMoney() : money(balance),
  updatedAt: instant(1_699_000_000_000),
})

describe('wallet.topup', () => {
  it('matches the golden payload', () => {
    const r = decideWalletTopup(ctx, wallet(0), {
      amount: money(50000),
      source: 'pos',
      paymentId: 'pay_1',
      providerRef: 'oid_abc',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('wallet.topup')
    expect(r.value.events[0]?.payload).toEqual(walletTopup)
    expect(r.value.next.balance.amount).toBe(50000)
  })
})

describe('wallet.purchase', () => {
  it('matches the golden payload', () => {
    const r = decideWalletPurchase(ctx, wallet(50000), {
      amount: money(12000),
      saleId: 'sale_1',
      paymentId: 'pay_2',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('wallet.purchase')
    expect(r.value.events[0]?.payload).toEqual(walletPurchase)
    expect(r.value.next.balance.amount).toBe(38000)
  })
})
