import {
  addMoney,
  money,
  newOperationId,
  subtractMoney,
  zeroMoney,
  type BranchId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type Money,
  type OperationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  couponDiscount,
  decideAllocate,
  decideCancelSale,
  decideCloseDrawer,
  decideCreatePlan,
  decideCreateSale,
  decideIssueGiftCard,
  decideArchiveDrawer,
  decideCreateDrawer,
  decideOpenDrawer,
  decideReactivateDrawer,
  decideRenameDrawer,
  decideReceivePayment,
  decideRefund,
  decideVoidPayment,
  decideWalletPurchase,
  type DecideContext,
} from '../domain/decide'
import {
  giftCardRemaining,
  memberBalance,
  paymentUnallocated,
  saleBalanceDue,
  type Discount,
  type GiftCard,
  type Instalment,
  type Payment,
  type PaymentMethod,
  type PaymentPlan,
  type Sale,
  type SaleLine,
} from '../domain/types'
import type { DrawerDelta, FinanceDeps, WalletApply } from './ports'

const SOURCE: EventSource = 'reception_web'
export const dctx = (deps: FinanceDeps, ctx: TenantContext, correlationId: OperationId): DecideContext => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId,
  // Almost always reception. The MIGRATION overrides it — a historical sale that told the log
  // `reception_web` would be a falsehood in the one place we can never go back and correct.
  source: deps.source ?? SOURCE,
})

// ── SELL — the act reception actually performs ───────────────────────────────────────────────
//
// A sale, its payment and their allocation are ONE operation (OP-2): one OperationId, so the
// Activity Center shows "Reyhan → Ayşe'ye Reformer 8 Ders sattı, 2.000 ₺ tahsil etti" as one act
// and not three unrelated rows. And they commit in ONE transaction (#1): a sale without its payment,
// or a payment without its allocation, is a cari hesap that lies from the first day.
export interface SellInput {
  readonly saleId: string
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly lines: readonly SaleLine[]
  readonly discounts: readonly Discount[]
  readonly discountCeilingPercent: number | null
  // The payment is OPTIONAL: selling without collecting is legal here (balanceDue > 0), and the
  // dashboard is built to surface it.
  readonly payment: {
    readonly paymentId: string
    readonly allocationId: string
    readonly amount: Money
    readonly method: PaymentMethod
    readonly receivedAt: Instant
    readonly drawerId: string | null
    readonly giftCardCode: string | null
    readonly note: string | null
    readonly providerRef?: string | null // Plus Phase 6 — online (PAYTR) reference; null for cash/manual
    readonly allowNoDrawer?: boolean // desk backfill: record cash truthfully drawerless when no kasa is open
  } | null
  // OP-2 — set when this sale is part of a larger act (a package sale grants the entitlement and
  // records the money under ONE operation id, so the Activity Center reads it as one sentence).
  readonly operationId?: OperationId
}

export async function sell(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: SellInput,
): Promise<Result<{ saleId: string; paymentId: string | null }, DomainError>> {
  const operationId = input.operationId ?? newOperationId()
  const c = dctx(deps, ctx, operationId)

  const created = decideCreateSale(c, {
    saleId: input.saleId,
    memberId: input.memberId,
    branchId: input.branchId,
    lines: input.lines,
    discounts: input.discounts,
    discountCeilingPercent: input.discountCeilingPercent,
  })
  if (!created.ok) return created

  let sale = created.value.next
  const events = [...created.value.events]
  const write: {
    sales: Sale[]
    payments: Payment[]
    allocations: NonNullable<Parameters<typeof deps.repo.commit>[1]['allocations']>[number][]
    drawerDeltas: DrawerDelta[]
    giftCards: GiftCard[]
    walletApplies: WalletApply[]
  } = { sales: [], payments: [], allocations: [], drawerDeltas: [], giftCards: [], walletApplies: [] }

  let paymentId: string | null = null

  if (input.payment) {
    const drawer = input.payment.drawerId
      ? await deps.repo.getDrawer(ctx, input.payment.drawerId)
      : null
    const card = input.payment.giftCardCode
      ? await deps.repo.getGiftCardByCode(ctx, input.payment.giftCardCode)
      : null

    const received = decideReceivePayment(
      c,
      {
        paymentId: input.payment.paymentId,
        memberId: input.memberId,
        branchId: input.branchId,
        amount: input.payment.amount,
        method: input.payment.method,
        receivedAt: input.payment.receivedAt,
        drawerId: input.payment.drawerId,
        giftCardId: card?.id ?? null,
        providerRef: input.payment.providerRef ?? null,
        note: input.payment.note,
        allowNoDrawer: input.payment.allowNoDrawer ?? false,
      },
      drawer,
      card,
    )
    if (!received.ok) return received

    // The allocation is what makes the money mean something: it says WHICH debt this settles. A
    // payment with no allocation is cash in a drawer with no story.
    const allocAmount = money(Math.min(received.value.next.amount.amount, saleBalanceDue(sale)))
    let payment = received.value.next
    events.push(...received.value.events)

    if (allocAmount.amount > 0) {
      const allocated = decideAllocate(c, payment, sale, allocAmount, input.payment.allocationId)
      if (!allocated.ok) return allocated
      sale = allocated.value.next.sale
      payment = allocated.value.next.payment
      write.allocations.push(allocated.value.next.allocation)
      events.push(...allocated.value.events)
    }

    // The drawer's expected balance moves with the money — that is what makes a gün sonu possible.
    //
    // A DELTA, never a rewritten document. The old code read the drawer outside the transaction and
    // wrote back a total computed from a snapshot that was already stale by the time it landed: twelve
    // concurrent cash payments each wrote "3.000", and eleven of them vanished from the till.
    if (drawer && (payment.method === 'cash' || payment.method === 'pos')) {
      write.drawerDeltas.push({ drawerId: drawer.id, deltaKurus: payment.amount.amount })
    }
    if (card) {
      write.giftCards.push({ ...card, redeemed: addMoney(card.redeemed, payment.amount) })
    }
    // The WALLET as a payment method — the stored-value balance IS the money. Debit it in the SAME
    // transaction (a purchase never spends below zero, I-37), and recognise revenue here on the wallet
    // payment, exactly as cash would. The wallet event's balanceAfter is finalised in the transaction,
    // so the log never records a stale balance.
    if (payment.method === 'wallet') {
      const wallet = await deps.repo.getWalletByMember(ctx, input.memberId)
      if (!wallet) return { ok: false, error: { code: 'wallet_insufficient', balance: 0, requested: payment.amount.amount } }
      const spent = decideWalletPurchase(c, wallet, { amount: payment.amount, saleId: sale.id, paymentId: payment.id })
      if (!spent.ok) return spent
      write.walletApplies.push({
        walletId: wallet.id,
        memberId: input.memberId,
        deltaKurus: -payment.amount.amount,
        refuseBelowZero: true,
        event: spent.value.events[0]!,
      })
    }
    write.payments.push(payment)
    paymentId = payment.id
  }

  write.sales.push(sale)
  await deps.repo.commit(ctx, { ...write, events })
  return { ok: true, value: { saleId: sale.id, paymentId } }
}

// ── COLLECT — a payment against existing debt (kısmi ödeme lives here) ───────────────────────
export interface CollectInput {
  readonly paymentId: string
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly amount: Money
  readonly method: PaymentMethod
  readonly receivedAt: Instant
  readonly drawerId: string | null
  readonly giftCardCode: string | null
  readonly note: string | null
  readonly allowNoDrawer?: boolean // desk backfill: record cash truthfully drawerless when no kasa is open
  // Which sales it pays, in order. Omitted ⇒ oldest debt first, which is what reception means when
  // she says "bakiyesine yaz".
  readonly allocateTo?: readonly { saleId: string; amount: Money; allocationId: string }[]
  readonly allocationIdPrefix?: string
}

export async function collect(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: CollectInput,
): Promise<Result<{ paymentId: string; unallocated: number }, DomainError>> {
  const operationId = newOperationId()
  const c = dctx(deps, ctx, operationId)

  const drawer = input.drawerId ? await deps.repo.getDrawer(ctx, input.drawerId) : null
  const card = input.giftCardCode ? await deps.repo.getGiftCardByCode(ctx, input.giftCardCode) : null

  const received = decideReceivePayment(
    c,
    {
      paymentId: input.paymentId,
      memberId: input.memberId,
      branchId: input.branchId,
      amount: input.amount,
      method: input.method,
      receivedAt: input.receivedAt,
      drawerId: input.drawerId,
      giftCardId: card?.id ?? null,
      providerRef: null,
      note: input.note,
      allowNoDrawer: input.allowNoDrawer ?? false,
    },
    drawer,
    card,
  )
  if (!received.ok) return received

  let payment = received.value.next
  const events = [...received.value.events]
  const sales: Sale[] = []
  const allocations = []

  // Oldest debt first — deterministic, and the only order that does not surprise a member reading
  // her own statement.
  const open = (await deps.repo.listSalesByMember(ctx, input.memberId))
    .filter((s) => s.status !== 'cancelled' && saleBalanceDue(s) > 0)
    .sort((a, b) => a.soldAt - b.soldAt)

  let i = 0
  for (const sale of open) {
    if (paymentUnallocated(payment) === 0) break
    const amount = money(Math.min(paymentUnallocated(payment), saleBalanceDue(sale)))
    const allocated = decideAllocate(c, payment, sale, amount, `${input.paymentId}_a${i++}`)
    if (!allocated.ok) return allocated
    payment = allocated.value.next.payment
    sales.push(allocated.value.next.sale)
    allocations.push(allocated.value.next.allocation)
    events.push(...allocated.value.events)
  }

  await deps.repo.commit(ctx, {
    sales,
    payments: [payment],
    allocations,
    ...(drawer && (payment.method === 'cash' || payment.method === 'pos')
      ? { drawerDeltas: [{ drawerId: drawer.id, deltaKurus: payment.amount.amount }] }
      : {}),
    ...(card ? { giftCards: [{ ...card, redeemed: addMoney(card.redeemed, payment.amount) }] } : {}),
    events,
  })

  // A surplus is MEMBER CREDIT (I-33), not a negative sale. It stays on the payment, visible.
  return { ok: true, value: { paymentId: payment.id, unallocated: paymentUnallocated(payment) } }
}

export async function voidPayment(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { paymentId: string; reason: string },
): Promise<Result<void, DomainError>> {
  const payment = await deps.repo.getPayment(ctx, input.paymentId)
  if (!payment) return { ok: false, error: { code: 'operation_not_applicable' } }

  const c = dctx(deps, ctx, newOperationId())
  const voided = decideVoidPayment(c, payment, input.reason)
  if (!voided.ok) return voided

  // Voiding un-pays every sale this payment settled — the ledger stays consistent by construction.
  const allocations = (await deps.repo.listAllocationsByMember(ctx, payment.memberId)).filter(
    (a) => a.paymentId === payment.id && !a.reversed,
  )
  const sales: Sale[] = []
  for (const a of allocations) {
    const sale = await deps.repo.getSale(ctx, a.saleId)
    if (!sale) continue
    sales.push({
      ...sale,
      paid: subtractMoney(sale.paid, a.amount),
      status: sale.status === 'settled' ? 'open' : sale.status,
    })
  }

  const drawer = payment.drawerId ? await deps.repo.getDrawer(ctx, payment.drawerId) : null

  await deps.repo.commit(ctx, {
    payments: [voided.value.next],
    sales,
    allocations: allocations.map((a) => ({ ...a, reversed: true })),
    ...(drawer && (payment.method === 'cash' || payment.method === 'pos')
      ? { drawerDeltas: [{ drawerId: drawer.id, deltaKurus: -payment.amount.amount }] }
      : {}),
    events: voided.value.events,
  })
  return { ok: true, value: undefined }
}

export async function refund(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { refundId: string; paymentId: string; amount: Money; reason: string },
): Promise<Result<void, DomainError>> {
  const payment = await deps.repo.getPayment(ctx, input.paymentId)
  if (!payment) return { ok: false, error: { code: 'operation_not_applicable' } }

  const c = dctx(deps, ctx, newOperationId())
  const decided = decideRefund(c, payment, input.amount, input.reason, input.refundId)
  if (!decided.ok) return decided

  const drawer = payment.drawerId ? await deps.repo.getDrawer(ctx, payment.drawerId) : null
  await deps.repo.commit(ctx, {
    refunds: [
      {
        id: input.refundId,
        studioId: ctx.studioId,
        memberId: payment.memberId,
        paymentId: payment.id,
        amount: input.amount,
        method: payment.method,
        reason: input.reason,
        at: c.now,
        by: ctx.actor,
        drawerId: payment.drawerId,
      },
    ],
    ...(drawer && (payment.method === 'cash' || payment.method === 'pos')
      ? { drawerDeltas: [{ drawerId: drawer.id, deltaKurus: -input.amount.amount }] }
      : {}),
    events: decided.value.events,
  })
  return { ok: true, value: undefined }
}

export async function cancelSale(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { saleId: string; reason: string },
): Promise<Result<void, DomainError>> {
  const sale = await deps.repo.getSale(ctx, input.saleId)
  if (!sale) return { ok: false, error: { code: 'operation_not_applicable' } }

  const c = dctx(deps, ctx, newOperationId())
  const decided = decideCancelSale(c, sale, input.reason)
  if (!decided.ok) return decided
  await deps.repo.commit(ctx, { sales: [decided.value.next], events: decided.value.events })
  return { ok: true, value: undefined }
}

// ── KASA ────────────────────────────────────────────────────────────────────────────────────

/**
 * Create the till. Once, in Ayarlar (hotfix B-2).
 *
 * A studio starts with none and nothing could make one, so reception could take no cash at all. It is
 * created here rather than by the bootstrap script (owner, 2026-07-13) because a studio may want a
 * second till later — a POS drawer beside the cash one — and that is a setup decision, not a
 * one-time-at-birth accident.
 */
export async function createDrawer(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { drawerId: string; branchId: BranchId; name: string; kind: 'cash' | 'pos' },
): Promise<Result<void, DomainError>> {
  const existing = await deps.repo.getDrawer(ctx, input.drawerId)
  const decided = decideCreateDrawer(dctx(deps, ctx, newOperationId()), existing, input)
  if (!decided.ok) return decided
  await deps.repo.saveDrawer(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}

export async function openDrawer(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { drawerId: string; openingFloat: Money },
): Promise<Result<void, DomainError>> {
  const drawer = await deps.repo.getDrawer(ctx, input.drawerId)
  if (!drawer) return { ok: false, error: { code: 'operation_not_applicable' } }

  const decided = decideOpenDrawer(dctx(deps, ctx, newOperationId()), drawer, input.openingFloat)
  if (!decided.ok) return decided
  await deps.repo.saveDrawer(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}

// Rename / archive / reactivate a till (PF-15). Load → decide → transact, like the others.
export async function renameDrawer(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { drawerId: string; name: string },
): Promise<Result<void, DomainError>> {
  const drawer = await deps.repo.getDrawer(ctx, input.drawerId)
  if (!drawer) return { ok: false, error: { code: 'operation_not_applicable' } }
  const decided = decideRenameDrawer(dctx(deps, ctx, newOperationId()), drawer, input.name)
  if (!decided.ok) return decided
  await deps.repo.saveDrawer(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}

export async function setDrawerActive(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { drawerId: string; active: boolean },
): Promise<Result<void, DomainError>> {
  const drawer = await deps.repo.getDrawer(ctx, input.drawerId)
  if (!drawer) return { ok: false, error: { code: 'operation_not_applicable' } }
  const c = dctx(deps, ctx, newOperationId())
  const decided = input.active ? decideReactivateDrawer(c, drawer) : decideArchiveDrawer(c, drawer)
  if (!decided.ok) return decided
  await deps.repo.saveDrawer(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}

// GÜN SONU.
export async function closeDrawer(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { drawerId: string; counted: Money; note: string | null },
): Promise<Result<{ discrepancy: number }, DomainError>> {
  const drawer = await deps.repo.getDrawer(ctx, input.drawerId)
  if (!drawer) return { ok: false, error: { code: 'operation_not_applicable' } }

  const decided = decideCloseDrawer(
    dctx(deps, ctx, newOperationId()),
    drawer,
    input.counted,
    input.note,
  )
  if (!decided.ok) return decided
  await deps.repo.saveDrawer(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: { discrepancy: decided.value.next.discrepancy?.amount ?? 0 } }
}

// ── GIFT CARD & COUPON ──────────────────────────────────────────────────────────────────────
export async function issueGiftCard(
  deps: FinanceDeps,
  ctx: TenantContext,
  card: GiftCard,
): Promise<Result<{ giftCardId: string }, DomainError>> {
  const decided = decideIssueGiftCard(dctx(deps, ctx, newOperationId()), card)
  if (!decided.ok) return decided
  await deps.repo.commit(ctx, { giftCards: [decided.value.next], events: decided.value.events })
  return { ok: true, value: { giftCardId: card.id } }
}

// The coupon is DATA; this only resolves what it is worth against a given gross (I-34: an amount,
// stamped at sale time — never a percentage re-applied in 2027 under a different rounding rule).
export async function resolveCoupon(
  deps: FinanceDeps,
  ctx: TenantContext,
  code: string,
  gross: Money,
): Promise<Result<{ discount: Money; code: string }, DomainError>> {
  const coupon = await deps.repo.getCouponByCode(ctx, code)
  const now = deps.clock.now()
  if (
    !coupon ||
    !coupon.active ||
    coupon.validFrom > now ||
    coupon.validUntil < now ||
    (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions)
  ) {
    return { ok: false, error: { code: 'coupon_invalid' } }
  }
  return { ok: true, value: { discount: couponDiscount(coupon, gross), code: coupon.code } }
}

export async function createPlan(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: { planId: string; saleId: string; instalments: readonly Instalment[] },
): Promise<Result<{ planId: string }, DomainError>> {
  const sale = await deps.repo.getSale(ctx, input.saleId)
  if (!sale) return { ok: false, error: { code: 'operation_not_applicable' } }

  const c = dctx(deps, ctx, newOperationId())
  const plan: PaymentPlan = {
    id: input.planId,
    studioId: ctx.studioId,
    memberId: sale.memberId,
    saleId: sale.id,
    instalments: input.instalments,
    createdAt: c.now,
    createdBy: ctx.actor,
    cancelled: false,
  }
  const decided = decideCreatePlan(c, plan, sale)
  if (!decided.ok) return decided
  await deps.repo.commit(ctx, { plans: [decided.value.next], events: decided.value.events })
  return { ok: true, value: { planId: plan.id } }
}

// ── CARİ HESAP — derived, never stored as the truth (owner's principle 1) ────────────────────
export interface MemberAccount {
  readonly sales: readonly Sale[]
  readonly payments: readonly Payment[]
  readonly balanceKurus: number // + ⇒ she owes the studio; − ⇒ the studio holds her money
  readonly totalSoldKurus: number
  readonly totalPaidKurus: number
  readonly openSales: readonly Sale[]
  readonly plans: readonly PaymentPlan[]
  readonly unallocatedKurus: number // her credit with the studio
}

export async function loadMemberAccount(
  deps: FinanceDeps,
  ctx: TenantContext,
  memberId: MemberId,
): Promise<MemberAccount> {
  const [sales, payments, refunds, plans] = await Promise.all([
    deps.repo.listSalesByMember(ctx, memberId),
    deps.repo.listPaymentsByMember(ctx, memberId),
    deps.repo.listRefundsByMember(ctx, memberId),
    deps.repo.listPlansByMember(ctx, memberId),
  ])

  const live = sales.filter((s) => s.status !== 'cancelled')
  return {
    sales,
    payments,
    balanceKurus: memberBalance(sales, payments, refunds),
    totalSoldKurus: live.reduce((n, s) => n + s.total.amount, 0),
    totalPaidKurus: payments.filter((p) => !p.voided).reduce((n, p) => n + p.amount.amount, 0),
    openSales: live.filter((s) => saleBalanceDue(s) > 0),
    plans: plans.filter((p) => !p.cancelled),
    unallocatedKurus: payments.reduce((n, p) => n + paymentUnallocated(p), 0),
  }
}

export const remainingOnCard = giftCardRemaining
export const zeroTry = zeroMoney
