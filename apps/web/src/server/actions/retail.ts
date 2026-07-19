'use server'

import {
  FirestoreFinanceRepository,
  money,
  newOperationId,
  sell,
  systemClock,
  type BranchId,
  type FinanceDeps,
  type MemberId,
  type PaymentMethod,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── RETAIL PRODUCTS (Plus Phase 6, §6) — a LIGHTWEIGHT catalogue for physical items (matara, çorap,
//    havlu). It is config (studios/{sid}/retailProducts), NOT a full event-sourced module — the same
//    choice as room notes / notification templates. The MONEY always goes through the finance `sell`
//    use-case (one sale path, never a parallel ledger). Stock is a simple counter, decremented in a
//    transaction so two concurrent sales can never oversell (the DEBT-028 lost-update discipline). ──

const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const
const financeDeps = (): FinanceDeps => ({ repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock })

export interface RetailProductRow {
  readonly id: string
  readonly name: string
  readonly sku: string
  readonly priceInKurus: number
  readonly taxRatePercent: number
  readonly trackStock: boolean
  readonly stock: number
  readonly active: boolean
  readonly category: string
}

function col(studioId: string) {
  return adminDb().collection('studios').doc(studioId).collection('retailProducts')
}

export async function listRetailProductsAction(): Promise<readonly RetailProductRow[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await col(ctx.studioId).orderBy('name').get()
  return snap.docs.map((d) => {
    const x = d.data()
    return {
      id: d.id,
      name: String(x.name ?? ''),
      sku: String(x.sku ?? ''),
      priceInKurus: Number(x.priceInKurus ?? 0),
      taxRatePercent: Number(x.taxRatePercent ?? 0),
      trackStock: x.trackStock === true,
      stock: Number(x.stock ?? 0),
      active: x.active !== false,
      category: String(x.category ?? ''),
    }
  })
}

export async function upsertRetailProductAction(input: unknown) {
  const p = z
    .object({
      id: z.string().optional(),
      name: z.string().trim().min(1),
      sku: z.string().default(''),
      priceInKurus: z.number().int().min(0),
      taxRatePercent: z.number().min(0).max(100).default(0),
      trackStock: z.boolean().default(false),
      stock: z.number().int().min(0).default(0),
      active: z.boolean().default(true),
      category: z.string().default(''),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const ref = p.id ? col(ctx.studioId).doc(p.id) : col(ctx.studioId).doc()
  const now = Date.now()
  const { id: _omit, ...fields } = p
  void _omit
  await ref.set({ ...fields, updatedAt: now, ...(p.id ? {} : { createdAt: now }) }, { merge: true })
  return { ok: true as const, value: { id: ref.id } }
}

export async function deactivateRetailProductAction(input: unknown) {
  const p = z.object({ id: z.string().min(1), active: z.boolean() }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await col(ctx.studioId).doc(p.id).set({ active: p.active, updatedAt: Date.now() }, { merge: true })
  return { ok: true as const }
}

// Sell one or more retail products to a member, collected by a MANUAL method (cash/transfer/card).
// Stock is decremented transactionally FIRST (no oversell); then the finance sale records the money.
export async function sellRetailProductAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      items: z.array(z.object({ retailProductId: z.string().min(1), quantity: z.number().int().min(1) })).min(1),
      method: z.enum(['cash', 'bank_transfer', 'credit_card', 'wallet']),
      // Optional explicit till: honoured only if it is open and of the method's kind; otherwise the
      // server auto-picks the single open till. Havale needs none.
      drawerId: z.string().min(1).nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const db = adminDb()

  // ── Stock + line build, transactionally (refuse oversell). ──
  let lines: { productId: null; description: string; quantity: number; unitPrice: ReturnType<typeof money>; entitlementId: null; giftCardId: null }[] = []
  let decremented: { id: string; qty: number }[] = []
  let total = 0
  try {
    const out = await db.runTransaction(async (tx) => {
      const built: typeof lines = []
      const dec: typeof decremented = []
      for (const item of p.items) {
        const ref = col(ctx.studioId).doc(item.retailProductId)
        const doc = await tx.get(ref)
        if (!doc.exists) throw new Error('not_found')
        const x = doc.data()!
        const price = Number(x.priceInKurus ?? 0)
        if (x.trackStock === true) {
          const stock = Number(x.stock ?? 0)
          if (stock < item.quantity) throw new Error(`out_of_stock:${stock}`)
          tx.set(ref, { stock: stock - item.quantity, updatedAt: Date.now() }, { merge: true })
          dec.push({ id: item.retailProductId, qty: item.quantity })
        }
        total += price * item.quantity
        built.push({
          productId: null,
          description: String(x.name ?? 'Ürün'),
          quantity: item.quantity,
          unitPrice: money(price),
          entitlementId: null,
          giftCardId: null,
        })
      }
      return { built, dec }
    })
    lines = out.built
    decremented = out.dec
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.startsWith('out_of_stock:')) return { ok: false as const, error: { code: 'retail_out_of_stock' as const, available: Number(msg.split(':')[1] ?? 0) } }
    return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }
  }

  // ── The money, through the ONE sale path. Cash needs an open cash till, a card (POS) an open pos
  //    till; havale and WALLET need none (wallet money is the balance itself). Honour an explicit open
  //    till of the right kind, else auto-pick. ──
  const drawerKind: 'cash' | 'pos' | null = p.method === 'cash' ? 'cash' : p.method === 'credit_card' ? 'pos' : null
  let drawerId: string | null = null
  if (drawerKind) {
    const openTills = (await financeDeps().repo.listDrawers(ctx)).filter((d) => d.status === 'open' && d.kind === drawerKind)
    drawerId = (p.drawerId ? openTills.find((d) => d.id === p.drawerId)?.id : undefined) ?? openTills[0]?.id ?? null
  }
  const opId = newOperationId()
  const suffix = opId.slice(4)
  const result = await sell(financeDeps(), ctx, {
    saleId: `sal_${suffix}`,
    memberId: p.memberId as MemberId,
    branchId: (ctx.branchIds[0] ?? null) as BranchId,
    lines,
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${suffix}`,
      allocationId: `alc_${suffix}`,
      amount: money(total),
      method: p.method as PaymentMethod,
      receivedAt: systemClock.now(),
      drawerId,
      giftCardCode: null,
      note: 'Ürün satışı',
    },
  })

  // The stock moved in a separate transaction from the money. If the sale is REFUSED (e.g. a wallet
  // with too little balance), put the stock back — an un-sold item that vanished from the shelf is a
  // phantom shortage reception would chase for nothing.
  if (!result.ok && decremented.length > 0) {
    await db.runTransaction(async (tx) => {
      const refs = decremented.map((d) => col(ctx.studioId).doc(d.id))
      const snaps = await Promise.all(refs.map((r) => tx.get(r)))
      snaps.forEach((s, i) => {
        if (s.exists) tx.set(s.ref, { stock: Number(s.data()!.stock ?? 0) + decremented[i]!.qty, updatedAt: Date.now() }, { merge: true })
      })
    })
  }
  return result
}
