import { describe, expect, it } from 'vitest'

import { instant, money, type MemberId, type TenantContext } from '../../../shared'
import type { Wallet } from '../domain/types'
import type { FinanceDeps, FinanceRepository, FinanceWrite } from './ports'
import { adjustWallet, topUpWallet } from './wallet'

const clock = { now: () => instant(1_700_000_000_000) }
const ctx = { studioId: 'std_1', actor: { type: 'owner', id: 'usr_1' } } as unknown as TenantContext
const MEMBER = 'mbr_1' as MemberId

function fake(existing: Wallet | null) {
  const writes: FinanceWrite[] = []
  const repo = {
    getWalletByMember: async () => existing,
    commit: async (_c: TenantContext, w: FinanceWrite) => {
      writes.push(w)
    },
  } as unknown as FinanceRepository
  const deps = { repo, clock } as unknown as FinanceDeps
  return { deps, writes }
}

describe('topUpWallet — the wallet is born on first top-up', () => {
  it('applies a positive delta that never refuses below zero, and returns the new balance', async () => {
    const { deps, writes } = fake(null)
    const r = await topUpWallet(deps, ctx, { memberId: MEMBER, amount: money(50000), source: 'cash' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.balance.amount).toBe(50000)
    const apply = writes[0]!.walletApplies![0]!
    expect(apply.deltaKurus).toBe(50000)
    expect(apply.refuseBelowZero).toBe(false)
    expect(apply.walletId).toBe('wal_mbr_1')
    expect(writes[0]!.drawerDeltas ?? []).toHaveLength(0)
  })

  it('a cash top-up into a till moves the drawer in the same write', async () => {
    const { deps, writes } = fake(null)
    await topUpWallet(deps, ctx, { memberId: MEMBER, amount: money(30000), source: 'cash', drawerId: 'drw_1' })
    expect(writes[0]!.drawerDeltas).toEqual([{ drawerId: 'drw_1', deltaKurus: 30000 }])
  })

  it('refuses a top-up of zero', async () => {
    const { deps, writes } = fake(null)
    const r = await topUpWallet(deps, ctx, { memberId: MEMBER, amount: money(0), source: 'manual' })
    expect(r.ok).toBe(false)
    expect(writes).toHaveLength(0) // nothing committed on a refusal
  })
})

describe('adjustWallet — a reasoned correction', () => {
  it('a debit adjustment carries refuseBelowZero so the txn enforces I-37', async () => {
    const wallet: Wallet = { id: 'wal_mbr_1', studioId: ctx.studioId, memberId: MEMBER, balance: money(5000), updatedAt: instant(1) }
    const { deps, writes } = fake(wallet)
    const r = await adjustWallet(deps, ctx, { memberId: MEMBER, direction: 'debit', amount: money(1000), reason: 'correction', note: 'düzeltme' })
    expect(r.ok).toBe(true)
    const apply = writes[0]!.walletApplies![0]!
    expect(apply.deltaKurus).toBe(-1000)
    expect(apply.refuseBelowZero).toBe(true)
  })

  it('a debit below the current balance is refused at decide time — nothing committed', async () => {
    const wallet: Wallet = { id: 'wal_mbr_1', studioId: ctx.studioId, memberId: MEMBER, balance: money(500), updatedAt: instant(1) }
    const { deps, writes } = fake(wallet)
    const r = await adjustWallet(deps, ctx, { memberId: MEMBER, direction: 'debit', amount: money(1000), reason: 'correction', note: 'x' })
    expect(r.ok).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('a credit adjustment needs a note', async () => {
    const { deps } = fake(null)
    const r = await adjustWallet(deps, ctx, { memberId: MEMBER, direction: 'credit', amount: money(1000), reason: 'gift', note: '  ' })
    expect(r.ok).toBe(false)
  })
})
