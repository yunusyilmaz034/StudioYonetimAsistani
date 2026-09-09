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

import { requireMemberContext, requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { memberBuyFromWallet, memberStore } from '../member-api'
import { readWalletView } from '../wallet-query'
import { createWalletTopupCheckout } from './payments'

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
      // 'pos' EKLENDİ (owner onayı, 2026-09-09). Fiziksel POS'tan yapılan yükleme 'manual' olarak
      // yazılıyordu: kasaya girmiyor, kart cirosunda görünmüyordu. 9 Eylül'de kartla çekilen 160 ₺
      // defterde hiçbir kasada yoktu. `WalletTopupSource` 'pos'u ZATEN tanıyordu ve `topUpWallet`
      // `drawerId` verilince kasa deltasını uyguluyordu — eksik olan yalnızca buraya gelen yoldu.
      // Bu ay beşinci kez aynı şekil: mekanizma var, çağıran yer kullanmıyor.
      source: z.enum(['cash', 'bank_transfer', 'manual', 'pos']),
      drawerId: z.string().min(1).nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  // Para fiziksel olarak bir kasaya girer: nakit NAKİT kasasına, kart POS kasasına. Havale hiçbir
  // kasaya girmez — banka hesabına gider ve stüdyonun çekmecesinde karşılığı yoktur.
  //
  // Açık kasa yoksa `drawerId` null kalır ve yükleme yine YAPILIR, sadece kasaya işlenmez. Kasası
  // kapalı diye üyenin parasını reddetmek, resepsiyonu kasa açmaya zorlamak için üyeyi bekletmektir;
  // ve bu stüdyoda POS kasası bugün hiç tanımlı değil.
  const drawerKind: 'cash' | 'pos' | null = p.source === 'cash' ? 'cash' : p.source === 'pos' ? 'pos' : null
  let drawerId: string | null = null
  if (drawerKind) {
    const open = (await financeDeps().repo.listDrawers(ctx)).filter((d) => d.status === 'open' && d.kind === drawerKind)
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

// ── Portal (web member, cookie-authed) — the member reads and spends her own stored-value wallet.
//    memberId comes from her session, never the request; the buy/topup reuse the exact member-app paths.
export async function portalWalletAction() {
  const { ctx, memberId } = await requireMemberContext()
  const [wallet, store] = await Promise.all([readWalletView(ctx, memberId), memberStore(ctx)])
  return { wallet, store }
}

export async function portalBuyFromWalletAction(input: unknown) {
  const p = z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).default(1) }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  return memberBuyFromWallet(ctx, memberId, p.productId, p.quantity)
}

export async function portalWalletTopupAction(input: unknown) {
  const p = z.object({ amountKurus: z.number().int().positive() }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  return createWalletTopupCheckout(ctx, memberId, p.amountKurus)
}
