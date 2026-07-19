'use server'

import {
  adjustWallet,
  FirestoreFinanceRepository,
  money,
  systemClock,
  topUpWallet,
  type FinanceDeps,
  type MemberId,
} from '@studio/core'
import type { StoredWallet } from '@studio/core/client'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { readWalletView } from '../wallet-query'

// The stored-value wallet, from the desk. Reception/owner loads a member's balance (cash into a till,
// or a manual/havale record) and makes reasoned corrections. The MONEY goes through the finance
// use-cases (topUpWallet / adjustWallet) — never a parallel ledger — so the till and the log agree.

const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const financeDeps = (): FinanceDeps => ({ repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock })

export async function getMemberWalletAction(input: unknown): Promise<StoredWallet> {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return readWalletView(ctx, p.memberId as MemberId)
}

export async function topUpMemberWalletAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      amountKurus: z.number().int().positive(),
      source: z.enum(['cash', 'bank_transfer', 'manual']),
      drawerId: z.string().min(1).nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  // Cash physically enters a till — pick the honoured open cash drawer, else the single open one.
  let drawerId: string | null = null
  if (p.source === 'cash') {
    const open = (await financeDeps().repo.listDrawers(ctx)).filter((d) => d.status === 'open' && d.kind === 'cash')
    drawerId = (p.drawerId ? open.find((d) => d.id === p.drawerId)?.id : undefined) ?? open[0]?.id ?? null
  }

  const r = await topUpWallet(financeDeps(), ctx, {
    memberId: p.memberId as MemberId,
    amount: money(p.amountKurus),
    source: p.source,
    drawerId,
  })
  if (!r.ok) return { ok: false as const, error: r.error }
  return { ok: true as const, value: await readWalletView(ctx, p.memberId as MemberId) }
}

export async function adjustMemberWalletAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      direction: z.enum(['credit', 'debit']),
      amountKurus: z.number().int().positive(),
      reason: z.enum(['gift', 'correction', 'migration', 'support']),
      note: z.string().trim().min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const r = await adjustWallet(financeDeps(), ctx, {
    memberId: p.memberId as MemberId,
    direction: p.direction,
    amount: money(p.amountKurus),
    reason: p.reason,
    note: p.note,
  })
  if (!r.ok) return { ok: false as const, error: r.error }
  return { ok: true as const, value: await readWalletView(ctx, p.memberId as MemberId) }
}
