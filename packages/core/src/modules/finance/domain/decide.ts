import {
  addMoney,
  err,
  money,
  ok,
  subtractMoney,
  zeroMoney,
  type ActorRef,
  type AggregateKind,
  type BranchId,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type Money,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  ALLOCATION_APPLIED,
  COUPON_REDEEMED,
  DRAWER_CLOSED,
  DRAWER_DISCREPANCY,
  DRAWER_OPENED,
  GIFTCARD_ISSUED,
  GIFTCARD_REDEEMED,
  PAYMENT_RECEIVED,
  PAYMENT_REFUNDED,
  PAYMENT_VOIDED,
  PLAN_CREATED,
  SALE_CANCELLED,
  SALE_CREATED,
  SALE_SETTLED,
} from '../events'
import {
  giftCardRemaining,
  paymentUnallocated,
  saleBalanceDue,
  type Allocation,
  type CashDrawer,
  type Coupon,
  type Discount,
  type GiftCard,
  type Instalment,
  type Payment,
  type PaymentMethod,
  type PaymentPlan,
  type Sale,
  type SaleLine,
} from './types'

// PURE. (state, command, now) → events. No I/O, no clock, no randomness — ids arrive from the
// application, which is where randomness is allowed to live.
export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

export type Outcome<T> = { readonly next: T; readonly events: readonly NewEvent[] }

const base = (ctx: DecideContext, kind: AggregateKind, id: string, branchId: BranchId | null, related: Record<string, string | undefined>) => ({
  studioId: ctx.studioId,
  branchId,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind, id },
  related,
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

const sum = (amounts: readonly Money[]): Money =>
  amounts.reduce((acc, m) => addMoney(acc, m), zeroMoney())

// ── SALE ────────────────────────────────────────────────────────────────────────────────────
export interface CreateSaleInput {
  readonly saleId: string
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly lines: readonly SaleLine[]
  readonly discounts: readonly Discount[]
  readonly discountCeilingPercent: number | null // studio settings (owner, decision 4) — data, not code
}

export function decideCreateSale(
  ctx: DecideContext,
  input: CreateSaleInput,
): Result<Outcome<Sale>, DomainError> {
  if (input.lines.length === 0) return err({ code: 'invalid_amount' })

  const gross = sum(input.lines.map((l) => money(l.unitPrice.amount * l.quantity)))
  const discountTotal = sum(input.discounts.map((d) => d.amount))

  // A manual discount with no note is an unexplained hole in the revenue (I-36).
  if (input.discounts.some((d) => d.reason === 'manual' && d.note.trim() === '')) {
    return err({ code: 'reason_required' })
  }
  if (discountTotal.amount < 0 || gross.amount <= 0) return err({ code: 'invalid_amount' })
  // I-33 — a sale never goes below zero. An over-discount is a refusal, not a negative sale.
  if (discountTotal.amount > gross.amount) return err({ code: 'invalid_adjustment' })

  // The ceiling is DATA (studio settings), never a literal. Nothing in this file knows a percentage.
  if (input.discountCeilingPercent !== null && gross.amount > 0) {
    const pct = (discountTotal.amount / gross.amount) * 100
    if (pct > input.discountCeilingPercent && ctx.actor.type !== 'owner') {
      return err({ code: 'discount_exceeds_ceiling', ceilingPercent: input.discountCeilingPercent })
    }
  }

  const total = subtractMoney(gross, discountTotal)
  const sale: Sale = {
    id: input.saleId,
    studioId: ctx.studioId,
    branchId: input.branchId,
    memberId: input.memberId,
    lines: input.lines,
    discounts: input.discounts,
    gross,
    total,
    paid: zeroMoney(),
    status: 'open',
    soldBy: ctx.actor, // attribution, captured from the first sale (Doc 26 §2)
    soldAt: ctx.now,
    cancelledAt: null,
    cancelReason: null,
  }

  const events: NewEvent[] = [
    {
      ...base(ctx, 'payment', sale.id, sale.branchId, { memberId: input.memberId }),
      type: SALE_CREATED,
      payload: {
        gross,
        discountTotal,
        total,
        lineCount: input.lines.length,
        discountReasons: input.discounts.map((d) => d.reason),
        soldByType: ctx.actor.type,
      },
    },
  ]
  // A coupon's redemption is its own event: the coupon is data, and its usage counter is a ledger.
  for (const d of input.discounts.filter((x) => x.couponCode !== null)) {
    events.push({
      ...base(ctx, 'payment', sale.id, sale.branchId, { memberId: input.memberId }),
      type: COUPON_REDEEMED,
      payload: { code: d.couponCode, discount: d.amount, saleId: sale.id, redemptionsAfter: 0 },
    })
  }

  return ok({ next: sale, events })
}

export function decideCancelSale(
  ctx: DecideContext,
  sale: Sale,
  reason: string,
): Result<Outcome<Sale>, DomainError> {
  if (sale.status === 'cancelled') return err({ code: 'operation_not_applicable' })
  if (reason.trim() === '') return err({ code: 'reason_required' })

  const next: Sale = { ...sale, status: 'cancelled', cancelledAt: ctx.now, cancelReason: reason }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payment', sale.id, sale.branchId, { memberId: sale.memberId }),
        type: SALE_CANCELLED,
        // The amount travels in the event so revenue can go NET without a projector ever reading a
        // state document (the lesson of v1.23).
        payload: { reason, total: sale.total, paidBack: sale.paid },
      },
    ],
  })
}

// ── PAYMENT ─────────────────────────────────────────────────────────────────────────────────
export interface ReceivePaymentInput {
  readonly paymentId: string
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly amount: Money
  readonly method: PaymentMethod
  readonly receivedAt: Instant
  readonly drawerId: string | null
  readonly giftCardId: string | null
  readonly providerRef: string | null
  readonly note: string | null
}

export function decideReceivePayment(
  ctx: DecideContext,
  input: ReceivePaymentInput,
  drawer: CashDrawer | null,
  giftCard: GiftCard | null,
): Result<Outcome<Payment>, DomainError> {
  if (input.amount.amount <= 0) return err({ code: 'invalid_amount' })

  // Cash and card land in a KASA, and a closed kasa cannot take money — that is the whole point of
  // opening one.
  if (input.method === 'cash' || input.method === 'pos') {
    if (!drawer) return err({ code: 'drawer_required' })
    if (drawer.status !== 'open') return err({ code: 'drawer_not_open' })
  }

  // A gift card is a LIABILITY being spent (owner, decision 3). I-35: a redemption that would go
  // below zero is REFUSED, never clamped.
  if (input.method === 'gift_card') {
    if (!giftCard) return err({ code: 'giftcard_not_found' })
    if (!giftCard.active) return err({ code: 'giftcard_not_active' })
    if (giftCardRemaining(giftCard) < input.amount.amount) {
      return err({ code: 'giftcard_insufficient', remaining: giftCardRemaining(giftCard) })
    }
  }

  const payment: Payment = {
    id: input.paymentId,
    studioId: ctx.studioId,
    branchId: input.branchId,
    memberId: input.memberId,
    amount: input.amount,
    method: input.method,
    receivedAt: input.receivedAt, // cash basis: revenue is recognised HERE (owner, OQ-2)
    takenBy: ctx.actor,
    drawerId: input.drawerId,
    providerRef: input.providerRef,
    giftCardId: input.giftCardId,
    allocated: zeroMoney(),
    voided: false,
    voidReason: null,
    note: input.note,
  }

  const events: NewEvent[] = [
    {
      ...base(ctx, 'payment', payment.id, payment.branchId, { memberId: input.memberId, paymentId: payment.id }),
      type: PAYMENT_RECEIVED,
      payload: {
        amount: input.amount,
        method: input.method,
        drawerId: input.drawerId,
        giftCardId: input.giftCardId,
        providerRef: input.providerRef,
      },
    },
  ]
  if (input.method === 'gift_card' && giftCard) {
    events.push({
      ...base(ctx, 'payment', giftCard.id, payment.branchId, { memberId: input.memberId }),
      type: GIFTCARD_REDEEMED,
      payload: {
        amount: input.amount,
        remainingAfter: money(giftCardRemaining(giftCard) - input.amount.amount),
        paymentId: payment.id,
      },
    })
  }
  return ok({ next: payment, events })
}

// I-31 — a payment is NEVER mutated. A mistake is voided, with a reason, and the void is a fact of
// its own. The gün sonu is only trustworthy if this holds.
export function decideVoidPayment(
  ctx: DecideContext,
  payment: Payment,
  reason: string,
): Result<Outcome<Payment>, DomainError> {
  if (payment.voided) return err({ code: 'operation_not_applicable' })
  if (reason.trim() === '') return err({ code: 'reason_required' })

  const next: Payment = { ...payment, voided: true, voidReason: reason, allocated: zeroMoney() }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'payment', payment.id, payment.branchId, { memberId: payment.memberId, paymentId: payment.id }),
        type: PAYMENT_VOIDED,
        payload: { amount: payment.amount, reason, method: payment.method },
      },
    ],
  })
}

export function decideRefund(
  ctx: DecideContext,
  payment: Payment,
  amount: Money,
  reason: string,
  refundId: string,
): Result<Outcome<{ refundId: string }>, DomainError> {
  if (payment.voided) return err({ code: 'operation_not_applicable' })
  if (amount.amount <= 0 || amount.amount > payment.amount.amount) return err({ code: 'invalid_amount' })
  if (reason.trim() === '') return err({ code: 'reason_required' })

  return ok({
    next: { refundId },
    events: [
      {
        ...base(ctx, 'payment', refundId, payment.branchId, { memberId: payment.memberId, paymentId: payment.id }),
        type: PAYMENT_REFUNDED,
        payload: { amount, method: payment.method, reason, paymentId: payment.id },
      },
    ],
  })
}

// ── ALLOCATION — the join that makes partial payment expressible ────────────────────────────
export function decideAllocate(
  ctx: DecideContext,
  payment: Payment,
  sale: Sale,
  amount: Money,
  allocationId: string,
): Result<Outcome<{ allocation: Allocation; sale: Sale; payment: Payment }>, DomainError> {
  if (payment.voided) return err({ code: 'operation_not_applicable' })
  if (sale.status === 'cancelled') return err({ code: 'operation_not_applicable' })
  if (payment.memberId !== sale.memberId) return err({ code: 'branch_mismatch' })
  if (amount.amount <= 0) return err({ code: 'invalid_amount' })
  // I-32 — a payment can never pay more than it is worth.
  if (amount.amount > paymentUnallocated(payment)) return err({ code: 'allocation_exceeds_payment' })
  // I-33 — nor a sale take more than it is owed. The surplus stays on the payment as member credit.
  if (amount.amount > saleBalanceDue(sale)) return err({ code: 'allocation_exceeds_sale' })

  const nextSale: Sale = { ...sale, paid: addMoney(sale.paid, amount) }
  const settled = saleBalanceDue(nextSale) === 0
  const nextPayment: Payment = { ...payment, allocated: addMoney(payment.allocated, amount) }
  const allocation: Allocation = {
    id: allocationId,
    studioId: ctx.studioId,
    paymentId: payment.id,
    saleId: sale.id,
    memberId: sale.memberId,
    amount,
    at: ctx.now,
    by: ctx.actor,
    reversed: false,
  }

  const events: NewEvent[] = [
    {
      ...base(ctx, 'payment', allocation.id, sale.branchId, {
        memberId: sale.memberId,
        paymentId: payment.id,
      }),
      type: ALLOCATION_APPLIED,
      payload: {
        paymentId: payment.id,
        saleId: sale.id,
        amount,
        saleBalanceAfter: money(saleBalanceDue(nextSale)),
        paymentUnallocatedAfter: money(paymentUnallocated(nextPayment)),
      },
    },
  ]
  if (settled) {
    events.push({
      ...base(ctx, 'payment', sale.id, sale.branchId, { memberId: sale.memberId }),
      type: SALE_SETTLED,
      payload: { total: sale.total },
    })
  }

  return ok({
    next: {
      allocation,
      sale: settled ? { ...nextSale, status: 'settled' } : nextSale,
      payment: nextPayment,
    },
    events,
  })
}

// ── KASA (owner, decision 5: per branch, per shift) ─────────────────────────────────────────
export function decideOpenDrawer(
  ctx: DecideContext,
  drawer: CashDrawer,
  openingFloat: Money,
): Result<Outcome<CashDrawer>, DomainError> {
  if (drawer.status === 'open') return err({ code: 'drawer_already_open' })
  if (openingFloat.amount < 0) return err({ code: 'invalid_amount' })

  const next: CashDrawer = {
    ...drawer,
    status: 'open',
    openingFloat,
    expected: openingFloat,
    openedAt: ctx.now,
    openedBy: ctx.actor,
    closedAt: null,
    closedBy: null,
    countedAmount: null,
    discrepancy: null,
    closeNote: null,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'branch', drawer.id, drawer.branchId, {}),
        type: DRAWER_OPENED,
        payload: { openingFloat, kind: drawer.kind },
      },
    ],
  })
}

// GÜN SONU. The discrepancy is a RECORDED FACT — a day-end that quietly makes the numbers agree is
// not a control, it is a cover-up, and the owner is precisely the person that control exists for.
export function decideCloseDrawer(
  ctx: DecideContext,
  drawer: CashDrawer,
  counted: Money,
  note: string | null,
): Result<Outcome<CashDrawer>, DomainError> {
  if (drawer.status !== 'open') return err({ code: 'drawer_not_open' })
  if (counted.amount < 0) return err({ code: 'invalid_amount' })

  const discrepancy = money(counted.amount - drawer.expected.amount)
  // A discrepancy without an explanation is exactly the thing the day-end exists to surface.
  if (discrepancy.amount !== 0 && (note ?? '').trim() === '') return err({ code: 'reason_required' })

  const next: CashDrawer = {
    ...drawer,
    status: 'closed',
    closedAt: ctx.now,
    closedBy: ctx.actor,
    countedAmount: counted,
    discrepancy,
    closeNote: note,
  }

  const events: NewEvent[] = [
    {
      ...base(ctx, 'branch', drawer.id, drawer.branchId, {}),
      type: DRAWER_CLOSED,
      payload: { expected: drawer.expected, counted, discrepancy, note },
    },
  ]
  if (discrepancy.amount !== 0) {
    events.push({
      ...base(ctx, 'branch', drawer.id, drawer.branchId, {}),
      type: DRAWER_DISCREPANCY,
      payload: { expected: drawer.expected, counted, discrepancy, note: note ?? '' },
    })
  }
  return ok({ next, events })
}

// ── GIFT CARD ───────────────────────────────────────────────────────────────────────────────
export function decideIssueGiftCard(
  ctx: DecideContext,
  card: GiftCard,
): Result<Outcome<GiftCard>, DomainError> {
  if (card.issuedValue.amount <= 0) return err({ code: 'invalid_amount' })
  return ok({
    next: card,
    events: [
      {
        ...base(ctx, 'payment', card.id, null, {
          ...(card.issuedToMemberId ? { memberId: card.issuedToMemberId } : {}),
        }),
        type: GIFTCARD_ISSUED,
        payload: {
          value: card.issuedValue,
          saleId: card.saleId,
          issuedToMemberId: card.issuedToMemberId,
          validUntil: card.validUntil,
        },
      },
    ],
  })
}

// ── PAYMENT PLAN — an instalment is a PROMISE, not a payment. It never touches the ledger until
//    money actually moves; that is what makes "bekleyen ödemeler" honest. ─────────────────────
export function decideCreatePlan(
  ctx: DecideContext,
  plan: PaymentPlan,
  sale: Sale,
): Result<Outcome<PaymentPlan>, DomainError> {
  if (plan.instalments.length === 0) return err({ code: 'invalid_amount' })
  const total = sum(plan.instalments.map((i) => i.amount))
  // A plan that does not add up to the sale is a plan that will be argued about later.
  if (total.amount !== saleBalanceDue(sale)) return err({ code: 'plan_total_mismatch' })

  return ok({
    next: plan,
    events: [
      {
        ...base(ctx, 'payment', plan.id, sale.branchId, { memberId: sale.memberId }),
        type: PLAN_CREATED,
        payload: {
          saleId: sale.id,
          instalmentCount: plan.instalments.length,
          total,
          firstDueAt: plan.instalments[0]!.dueAt,
        },
      },
    ],
  })
}

// Pure: which instalments are overdue, as of `now`. No clock inside — the caller supplies it.
export const overdueInstalments = (plan: PaymentPlan, now: Instant): readonly Instalment[] =>
  plan.cancelled ? [] : plan.instalments.filter((i) => i.status === 'due' && i.dueAt < now)

export const couponDiscount = (coupon: Coupon, gross: Money): Money =>
  coupon.kind === 'percent'
    ? money(Math.round((gross.amount * coupon.value) / 100)) // rounded to kuruş AT SALE TIME (I-34)
    : money(Math.min(coupon.value, gross.amount))
