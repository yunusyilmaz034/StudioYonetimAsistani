import { walletIdFor, type MemberId, type TenantContext } from '@studio/core'
import type { StoredWallet, WalletTxn, WalletTxnKind } from '@studio/core/client'

import { adminDb } from './firebase-admin'

// The stored-value wallet, read through the Admin SDK (the collection is server-only). Balance comes
// from the denormalised wallet doc; the history is derived from the wallet events — never from a state
// document, so it reads exactly what the immutable log says (balanceAfter and all).

const KIND: Record<string, WalletTxnKind> = {
  'wallet.topup': 'topup',
  'wallet.purchase': 'purchase',
  'wallet.refund': 'refund',
  'wallet.adjustment': 'adjustment',
  'wallet.voided': 'void',
}
const SOURCE_TR: Record<string, string> = { online: 'Kart', pos: 'Sanal POS', cash: 'Nakit', bank_transfer: 'Havale', manual: 'Manuel' }
const REASON_TR: Record<string, string> = { gift: 'Hediye', correction: 'Düzeltme', migration: 'Devir', support: 'Destek' }

const msOf = (v: unknown): number => {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis()
  return typeof v === 'number' ? v : 0
}
const kurus = (v: unknown): number => Number((v as { amount?: number } | undefined)?.amount ?? 0)

function labelFor(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'wallet.topup':
      return `Bakiye yükleme · ${SOURCE_TR[String(p.source)] ?? 'Yükleme'}`
    case 'wallet.purchase':
      return 'Alışveriş'
    case 'wallet.refund':
      return 'İade'
    case 'wallet.adjustment':
      return `Düzeltme · ${REASON_TR[String(p.reason)] ?? ''}`.trim()
    case 'wallet.voided':
      return 'İptal edilen yükleme'
    default:
      return 'İşlem'
  }
}

export async function readWalletView(ctx: TenantContext, memberId: MemberId): Promise<StoredWallet> {
  const db = adminDb()
  const walletId = walletIdFor(memberId)
  const [walletSnap, evSnap] = await Promise.all([
    db.doc(`studios/${ctx.studioId}/wallets/${walletId}`).get(),
    // Equality-only query (no orderBy) so no composite index is needed — a wallet's event count is
    // small, so sorting in memory is cheap and avoids the prod-only index trap.
    db.collection(`studios/${ctx.studioId}/events`).where('subject.id', '==', walletId).get(),
  ])
  const balance = walletSnap.exists ? kurus(walletSnap.data()!.balance) : 0
  const history: WalletTxn[] = evSnap.docs
    .map((d) => {
      const e = d.data()
      const type = String(e.type ?? '')
      const p = (e.payload ?? {}) as Record<string, unknown>
      const isDebit = type === 'wallet.purchase' || type === 'wallet.voided' || (type === 'wallet.adjustment' && p.direction === 'debit')
      return {
        id: d.id,
        kind: KIND[type] ?? 'adjustment',
        direction: (isDebit ? 'out' : 'in') as 'in' | 'out',
        amount: kurus(p.amount),
        label: labelFor(type, p),
        at: msOf(e.occurredAt),
        balanceAfter: kurus(p.balanceAfter),
      }
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 50)
  return { balance, history }
}
