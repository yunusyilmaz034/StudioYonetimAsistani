'use server'

import {
  cancelSale,
  closeDrawer,
  collect,
  createPlan,
  FirestoreFinanceRepository,
  FirestoreSchedulingRepository,
  instant,
  issueGiftCard,
  loadMemberAccount,
  money,
  newOperationId,
  openDrawer,
  refund,
  resolveCoupon,
  sell,
  systemClock,
  voidPayment,
  type BranchId,
  type FinanceDeps,
  type GiftCard,
  type MemberId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Finance is a SYNCHRONOUS, TRUSTED write, always (AD-35): it moves money. Nothing here is ever an
// offline command. Reception sells and collects; only the owner voids, refunds, cancels a sale, or
// discounts above the studio's ceiling (the domain enforces that last one — this file only decides
// who may knock on the door).
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const

const nonEmpty = z.string().min(1)
const kurus = z.number().int().min(0)

const deps = (): FinanceDeps => ({
  repo: new FirestoreFinanceRepository(adminDb()),
  clock: systemClock,
})

// The discount ceiling is DATA (owner, decision 4). Nothing in this file knows a percentage.
async function discountCeiling(ctx: Parameters<typeof loadMemberAccount>[1]): Promise<number | null> {
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  return settings?.discountCeilingPercent ?? null
}

const lineSchema = z.object({
  productId: z.string().nullable(),
  description: nonEmpty,
  quantity: z.number().int().min(1),
  unitPriceKurus: kurus,
})

const discountSchema = z.object({
  reason: z.enum(['campaign', 'coupon', 'referral', 'gift', 'manual']),
  amountKurus: kurus,
  note: z.string(),
  couponCode: z.string().nullable().default(null),
  referredByMemberId: z.string().nullable().default(null),
})

const paymentSchema = z.object({
  amountKurus: kurus,
  method: z.enum(['cash', 'bank_transfer', 'credit_card', 'pos', 'online', 'gift_card']),
  receivedAtMs: z.number().optional(),
  drawerId: z.string().nullable().default(null),
  giftCardCode: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
})

export async function sellAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      branchId: nonEmpty,
      lines: z.array(lineSchema).min(1),
      discounts: z.array(discountSchema).default([]),
      payment: paymentSchema.nullable().default(null),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const opId = newOperationId()

  return sell(deps(), ctx, {
    saleId: `sal_${opId.slice(4)}`,
    memberId: p.memberId as MemberId,
    branchId: p.branchId as BranchId,
    lines: p.lines.map((l) => ({
      productId: (l.productId ?? null) as never,
      description: l.description,
      quantity: l.quantity,
      unitPrice: money(l.unitPriceKurus),
      entitlementId: null,
      giftCardId: null,
    })),
    discounts: p.discounts.map((d) => ({
      reason: d.reason,
      amount: money(d.amountKurus),
      note: d.note,
      couponCode: d.couponCode,
      referredByMemberId: (d.referredByMemberId ?? null) as never,
      grantedBy: ctx.actor,
    })),
    discountCeilingPercent: await discountCeiling(ctx),
    payment: p.payment
      ? {
          paymentId: `pay_${opId.slice(4)}`,
          allocationId: `alc_${opId.slice(4)}`,
          amount: money(p.payment.amountKurus),
          method: p.payment.method,
          receivedAt: instant(p.payment.receivedAtMs ?? Date.now()),
          drawerId: p.payment.drawerId,
          giftCardCode: p.payment.giftCardCode,
          note: p.payment.note,
        }
      : null,
  })
}

// KISMİ ÖDEME lives here: a payment against existing debt, allocated oldest-first.
export async function collectAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      branchId: nonEmpty,
      amountKurus: kurus.refine((v) => v > 0, 'Tutar sıfırdan büyük olmalı'),
      method: paymentSchema.shape.method,
      receivedAtMs: z.number().optional(),
      drawerId: z.string().nullable().default(null),
      giftCardCode: z.string().nullable().default(null),
      note: z.string().nullable().default(null),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const opId = newOperationId()

  return collect(deps(), ctx, {
    paymentId: `pay_${opId.slice(4)}`,
    memberId: p.memberId as MemberId,
    branchId: p.branchId as BranchId,
    amount: money(p.amountKurus),
    method: p.method,
    receivedAt: instant(p.receivedAtMs ?? Date.now()),
    drawerId: p.drawerId,
    giftCardCode: p.giftCardCode,
    note: p.note,
  })
}

export async function voidPaymentAction(input: unknown) {
  const p = z.object({ paymentId: nonEmpty, reason: nonEmpty }).parse(input)
  return voidPayment(deps(), await requireTenantContext(OWNER), p)
}

export async function refundAction(input: unknown) {
  const p = z.object({ paymentId: nonEmpty, amountKurus: kurus, reason: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  return refund(deps(), ctx, {
    refundId: `rfn_${newOperationId().slice(4)}`,
    paymentId: p.paymentId,
    amount: money(p.amountKurus),
    reason: p.reason,
  })
}

export async function cancelSaleAction(input: unknown) {
  const p = z.object({ saleId: nonEmpty, reason: nonEmpty }).parse(input)
  return cancelSale(deps(), await requireTenantContext(OWNER), p)
}

// ── CARİ HESAP — derived from the movements; nothing is stored that cannot be re-derived ────
export async function memberAccountAction(input: unknown) {
  const p = z.object({ memberId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const account = await loadMemberAccount(deps(), ctx, p.memberId as MemberId)
  return {
    balanceKurus: account.balanceKurus,
    totalSoldKurus: account.totalSoldKurus,
    totalPaidKurus: account.totalPaidKurus,
    unallocatedKurus: account.unallocatedKurus,
    sales: account.sales.map((s) => ({
      id: s.id,
      soldAt: s.soldAt as number,
      total: s.total.amount,
      paid: s.paid.amount,
      status: s.status,
      lines: s.lines.map((l) => l.description),
      discountTotal: s.discounts.reduce((n, d) => n + d.amount.amount, 0),
      soldByType: s.soldBy.type,
    })),
    payments: account.payments.map((p2) => ({
      id: p2.id,
      receivedAt: p2.receivedAt as number,
      amount: p2.amount.amount,
      method: p2.method,
      voided: p2.voided,
      note: p2.note,
    })),
    plans: account.plans.map((pl) => ({
      id: pl.id,
      saleId: pl.saleId,
      instalments: pl.instalments.map((i) => ({
        seq: i.seq,
        dueAt: i.dueAt as number,
        amount: i.amount.amount,
        status: i.status,
      })),
    })),
  }
}

// ── KASA ────────────────────────────────────────────────────────────────────────────────────
export async function listDrawersAction() {
  const ctx = await requireTenantContext(OPS)
  const drawers = await new FirestoreFinanceRepository(adminDb()).listDrawers(ctx)
  return drawers.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    status: d.status,
    expected: d.expected.amount,
    openingFloat: d.openingFloat.amount,
    openedAt: d.openedAt as number | null,
    closedAt: d.closedAt as number | null,
    counted: d.countedAmount?.amount ?? null,
    discrepancy: d.discrepancy?.amount ?? null,
    closeNote: d.closeNote,
  }))
}

export async function openDrawerAction(input: unknown) {
  const p = z.object({ drawerId: nonEmpty, openingFloatKurus: kurus }).parse(input)
  return openDrawer(deps(), await requireTenantContext(OPS), {
    drawerId: p.drawerId,
    openingFloat: money(p.openingFloatKurus),
  })
}

// GÜN SONU. A discrepancy demands an explanation — the domain refuses without one.
export async function closeDrawerAction(input: unknown) {
  const p = z
    .object({ drawerId: nonEmpty, countedKurus: kurus, note: z.string().nullable().default(null) })
    .parse(input)
  return closeDrawer(deps(), await requireTenantContext(OPS), {
    drawerId: p.drawerId,
    counted: money(p.countedKurus),
    note: p.note,
  })
}

// ── GIFT CARD · COUPON · PLAN ───────────────────────────────────────────────────────────────
export async function issueGiftCardAction(input: unknown) {
  const p = z
    .object({
      code: nonEmpty,
      valueKurus: kurus.refine((v) => v > 0, 'Tutar sıfırdan büyük olmalı'),
      memberId: z.string().nullable().default(null),
      validUntilMs: z.number().nullable().default(null),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const card: GiftCard = {
    id: `gft_${newOperationId().slice(4)}`,
    studioId: ctx.studioId,
    code: p.code,
    issuedValue: money(p.valueKurus),
    redeemed: money(0),
    expired: money(0),
    validUntil: p.validUntilMs ? instant(p.validUntilMs) : null,
    issuedToMemberId: (p.memberId ?? null) as never,
    issuedAt: instant(Date.now()),
    issuedBy: ctx.actor,
    saleId: null,
    active: true,
  }
  return issueGiftCard(deps(), ctx, card)
}

export async function resolveCouponAction(input: unknown) {
  const p = z.object({ code: nonEmpty, grossKurus: kurus }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const r = await resolveCoupon(deps(), ctx, p.code, money(p.grossKurus))
  return r.ok ? { ok: true as const, discountKurus: r.value.discount.amount } : { ok: false as const }
}

export async function createPlanAction(input: unknown) {
  const p = z
    .object({
      saleId: nonEmpty,
      instalments: z.array(z.object({ dueAtMs: z.number(), amountKurus: kurus })).min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  return createPlan(deps(), ctx, {
    planId: `pln_${newOperationId().slice(4)}`,
    saleId: p.saleId,
    instalments: p.instalments.map((i, idx) => ({
      seq: idx + 1,
      dueAt: instant(i.dueAtMs),
      amount: money(i.amountKurus),
      status: 'due' as const,
      paymentId: null,
    })),
  })
}
