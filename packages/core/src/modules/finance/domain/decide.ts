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
  DRAWER_ARCHIVED,
  DRAWER_CLOSED,
  DRAWER_REACTIVATED,
  DRAWER_RENAMED,
  DRAWER_DISCREPANCY,
  DRAWER_CREATED,
  DRAWER_OPENED,
  GIFTCARD_ISSUED,
  GIFTCARD_REDEEMED,
  PAYMENT_LINK_CREATED,
  PAYMENT_LINK_DEACTIVATED,
  PAYMENT_RECEIVED,
  PAYMENT_REFUNDED,
  PAYMENT_VOIDED,
  PAYTR_COLLECTION_CANCELLED,
  PAYTR_COLLECTION_RECEIVED,
  PAYTR_COLLECTION_RECONCILED,
  PLAN_CREATED,
  SALE_CANCELLED,
  SALE_CREATED,
  SALE_SETTLED,
  WALLET_ADJUSTMENT,
  WALLET_PURCHASE,
  WALLET_REFUND,
  WALLET_TOPUP,
  WALLET_VOIDED,
  type WalletAdjustReason,
  type WalletTopupSource,
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
  type PaymentLink,
  type PaymentMethod,
  type PaymentPlan,
  type PaytrCollection,
  type Sale,
  type SaleLine,
  type Wallet,
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
  // Desk backfill (owner, 2026-07-20): reception is migrating old members THROUGH the panel — not the
  // `tools/migration` script the AD-66 exemption below was written for. When no cash drawer is open,
  // the desk flow sets this so a cash payment records TRUTHFULLY (method 'cash', drawerId null) instead
  // of being refused. When a kasa IS open the flow leaves this false and the drawer control still binds.
  readonly allowNoDrawer?: boolean
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
  //
  // ── The migration exemption (owner, 2026-07-13 · AD-66) ────────────────────────────────────
  // A migration is NOT a live operation. It does not take cash at the desk; it RECORDS cash that
  // was taken years ago, in a system that had no kasa at all. The drawer requirement is a control
  // over *the act of receiving money* — and that act already happened, unsupervised by a control
  // that did not yet exist. Enforcing it here would leave exactly three ways out, and all three
  // put a lie somewhere:
  //
  //   • open a synthetic "migration drawer"  → fabricates a gün sonu that never happened, in the
  //                                            one record the owner relies on to catch theft;
  //   • re-label the payment `bank_transfer` → falsifies how the member actually paid;
  //   • skip the payment entirely            → every migrated member appears to owe everything.
  //
  // So the payment is recorded with its TRUE method (`cash`) and a TRUTHFUL `drawerId: null` —
  // there was no drawer, and the record says so. Nothing is invented; what we do not know stays
  // empty. This is not an exception to a finance rule; it is a rule about who the actor is, and
  // `migration` is a first-class principal precisely so the domain can say things like this out
  // loud (#5). It cannot be reached by a human, by a client, or by an AI: the actor is derived
  // server-side and a migration actor exists only inside `tools/migration`, run by hand.
  const isMigration = ctx.actor.type === 'migration'
  if (!isMigration && !input.allowNoDrawer && (input.method === 'cash' || input.method === 'pos')) {
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
/**
 * Create a till (hotfix B-2, 2026-07-13).
 *
 * A studio starts with none, and until now nothing could make one: `openDrawer` refused a drawer that
 * did not exist, and no screen and no script created it. So on a fresh production project reception
 * could take **no cash at all** — every cash sale was refused with `drawer_required`, correctly, and
 * for ever.
 *
 * The till is created ONCE, in Ayarlar, and lives from then on. It is not created on the fly by the
 * first sale of the day: a till that appears when money needs somewhere to go is a till whose opening
 * balance nobody counted.
 */
export function decideCreateDrawer(
  ctx: DecideContext,
  existing: CashDrawer | null,
  input: { drawerId: string; branchId: BranchId; name: string; kind: 'cash' | 'pos' },
): Result<Outcome<CashDrawer>, DomainError> {
  if (existing) return err({ code: 'operation_not_applicable' })
  if (input.name.trim().length === 0) return err({ code: 'reason_required' })

  const next: CashDrawer = {
    id: input.drawerId,
    studioId: ctx.studioId,
    branchId: input.branchId,
    name: input.name.trim(),
    kind: input.kind,
    active: true,
    // Created CLOSED. It holds nothing until a human opens it and says what was in it — and that
    // opening float is the number the whole day-end count is judged against.
    status: 'closed',
    openingFloat: money(0),
    expected: money(0),
    openedAt: null,
    openedBy: null,
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
        ...base(ctx, 'branch', next.id, next.branchId, {}),
        type: DRAWER_CREATED,
        payload: { name: next.name, kind: next.kind },
      },
    ],
  })
}

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

// ── Rename / archive (PF-15). A till is corrected or retired, never deleted — its opens, closes and the
//    payments that reference it stay intact. ──
export function decideRenameDrawer(ctx: DecideContext, drawer: CashDrawer, name: string): Result<Outcome<CashDrawer>, DomainError> {
  const trimmed = name.trim()
  if (trimmed.length === 0) return err({ code: 'reason_required' })
  if (trimmed === drawer.name) return err({ code: 'operation_not_applicable' })
  const next: CashDrawer = { ...drawer, name: trimmed }
  return ok({
    next,
    events: [{ ...base(ctx, 'branch', drawer.id, drawer.branchId, {}), type: DRAWER_RENAMED, payload: { previousName: drawer.name, name: trimmed } }],
  })
}

export function decideArchiveDrawer(ctx: DecideContext, drawer: CashDrawer): Result<Outcome<CashDrawer>, DomainError> {
  // An OPEN till holds counted money — close it (gün sonu) before retiring it, so nothing is orphaned.
  if (drawer.status === 'open') return err({ code: 'drawer_open_cannot_archive' })
  if (!drawer.active) return err({ code: 'operation_not_applicable' })
  const next: CashDrawer = { ...drawer, active: false }
  return ok({
    next,
    events: [{ ...base(ctx, 'branch', drawer.id, drawer.branchId, {}), type: DRAWER_ARCHIVED, payload: { name: drawer.name } }],
  })
}

export function decideReactivateDrawer(ctx: DecideContext, drawer: CashDrawer): Result<Outcome<CashDrawer>, DomainError> {
  if (drawer.active) return err({ code: 'operation_not_applicable' })
  const next: CashDrawer = { ...drawer, active: true }
  return ok({
    next,
    events: [{ ...base(ctx, 'branch', drawer.id, drawer.branchId, {}), type: DRAWER_REACTIVATED, payload: { name: drawer.name } }],
  })
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

// ── MEMBER WALLET (Doc 27, v1.27) — stored value: money in (topup/refund/credit), money out
//    (purchase/void/debit). The wallet's `balance` is denormalised; these are the ONLY functions
//    allowed to move it. Every op carries `balanceAfter`, and a debit that would cross zero is
//    REFUSED, never clamped (I-37). `amount` is always positive kuruş — the event TYPE says direction.
const walletMoved = (wallet: Wallet, balance: Money, now: Instant): Wallet => ({
  ...wallet,
  balance,
  updatedAt: now,
})

export function decideWalletTopup(
  ctx: DecideContext,
  wallet: Wallet,
  input: {
    readonly amount: Money
    readonly source: WalletTopupSource
    readonly paymentId: string | null
    readonly providerRef: string | null
  },
): Result<Outcome<Wallet>, DomainError> {
  if (input.amount.amount <= 0) return err({ code: 'invalid_amount' })
  const balanceAfter = addMoney(wallet.balance, input.amount)
  return ok({
    next: walletMoved(wallet, balanceAfter, ctx.now),
    events: [
      {
        ...base(ctx, 'wallet', wallet.id, null, { memberId: wallet.memberId }),
        type: WALLET_TOPUP,
        payload: {
          amount: input.amount,
          source: input.source,
          paymentId: input.paymentId,
          providerRef: input.providerRef,
          balanceAfter,
        },
      },
    ],
  })
}

export function decideWalletPurchase(
  ctx: DecideContext,
  wallet: Wallet,
  input: { readonly amount: Money; readonly saleId: string; readonly paymentId: string },
): Result<Outcome<Wallet>, DomainError> {
  if (input.amount.amount <= 0) return err({ code: 'invalid_amount' })
  if (wallet.balance.amount < input.amount.amount)
    return err({ code: 'wallet_insufficient', balance: wallet.balance.amount, requested: input.amount.amount })
  const balanceAfter = subtractMoney(wallet.balance, input.amount)
  return ok({
    next: walletMoved(wallet, balanceAfter, ctx.now),
    events: [
      {
        ...base(ctx, 'wallet', wallet.id, null, { memberId: wallet.memberId }),
        type: WALLET_PURCHASE,
        payload: { amount: input.amount, saleId: input.saleId, paymentId: input.paymentId, balanceAfter },
      },
    ],
  })
}

export function decideWalletRefund(
  ctx: DecideContext,
  wallet: Wallet,
  input: { readonly amount: Money; readonly reason: string; readonly originalSaleId: string | null },
): Result<Outcome<Wallet>, DomainError> {
  if (input.amount.amount <= 0) return err({ code: 'invalid_amount' })
  if (input.reason.trim() === '') return err({ code: 'reason_required' })
  const balanceAfter = addMoney(wallet.balance, input.amount)
  return ok({
    next: walletMoved(wallet, balanceAfter, ctx.now),
    events: [
      {
        ...base(ctx, 'wallet', wallet.id, null, { memberId: wallet.memberId }),
        type: WALLET_REFUND,
        payload: {
          amount: input.amount,
          reason: input.reason,
          originalSaleId: input.originalSaleId,
          balanceAfter,
        },
      },
    ],
  })
}

export function decideWalletAdjustment(
  ctx: DecideContext,
  wallet: Wallet,
  input: {
    readonly direction: 'credit' | 'debit'
    readonly amount: Money
    readonly reason: WalletAdjustReason
    readonly note: string
  },
): Result<Outcome<Wallet>, DomainError> {
  if (input.amount.amount <= 0) return err({ code: 'invalid_amount' })
  if (input.note.trim() === '') return err({ code: 'note_required' }) // AD-39 shape: a reasoned note is mandatory
  if (input.direction === 'debit' && wallet.balance.amount < input.amount.amount)
    return err({ code: 'wallet_insufficient', balance: wallet.balance.amount, requested: input.amount.amount })
  const balanceAfter =
    input.direction === 'credit' ? addMoney(wallet.balance, input.amount) : subtractMoney(wallet.balance, input.amount)
  return ok({
    next: walletMoved(wallet, balanceAfter, ctx.now),
    events: [
      {
        ...base(ctx, 'wallet', wallet.id, null, { memberId: wallet.memberId }),
        type: WALLET_ADJUSTMENT,
        payload: {
          direction: input.direction,
          amount: input.amount,
          reason: input.reason,
          note: input.note,
          balanceAfter,
        },
      },
    ],
  })
}

export function decideWalletVoid(
  ctx: DecideContext,
  wallet: Wallet,
  input: { readonly amount: Money; readonly topupId: string; readonly reason: string },
): Result<Outcome<Wallet>, DomainError> {
  if (input.amount.amount <= 0) return err({ code: 'invalid_amount' })
  if (input.reason.trim() === '') return err({ code: 'reason_required' })
  if (wallet.balance.amount < input.amount.amount)
    return err({ code: 'wallet_insufficient', balance: wallet.balance.amount, requested: input.amount.amount })
  const balanceAfter = subtractMoney(wallet.balance, input.amount)
  return ok({
    next: walletMoved(wallet, balanceAfter, ctx.now),
    events: [
      {
        ...base(ctx, 'wallet', wallet.id, null, { memberId: wallet.memberId }),
        type: WALLET_VOIDED,
        payload: { amount: input.amount, topupId: input.topupId, reason: input.reason, balanceAfter },
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

// ── PF-37: shareable PAYTR links + unattributed collections ───────────────────────────────────
// The link is a template (config); the collection is MONEY that arrived without a member, so it sits
// in an "unreconciled" inbox until reception attributes it — where the real ledger entry is born.

export function decideCreatePaymentLink(ctx: DecideContext, link: PaymentLink): NewEvent[] {
  return [
    {
      ...base(ctx, 'payment_link', link.id, null, {}),
      type: PAYMENT_LINK_CREATED,
      payload: { linkId: link.id, amount: link.amount, maxInstallments: link.maxInstallments },
    },
  ]
}

export function decideDeactivatePaymentLink(ctx: DecideContext, link: PaymentLink): Outcome<PaymentLink> {
  if (!link.active) return { next: link, events: [] } // idempotent
  return {
    next: { ...link, active: false },
    events: [{ ...base(ctx, 'payment_link', link.id, null, {}), type: PAYMENT_LINK_DEACTIVATED, payload: { linkId: link.id } }],
  }
}

export function decideReceiveCollection(ctx: DecideContext, collection: PaytrCollection): NewEvent[] {
  return [
    {
      ...base(ctx, 'paytr_collection', collection.id, null, { linkId: collection.linkId }),
      type: PAYTR_COLLECTION_RECEIVED,
      payload: { collectionId: collection.id, linkId: collection.linkId, amount: collection.amount, installments: collection.installments },
    },
  ]
}

export function decideReconcileCollection(
  ctx: DecideContext,
  collection: PaytrCollection,
  memberId: MemberId,
  paymentId: string,
): Result<Outcome<PaytrCollection>, DomainError> {
  if (collection.status !== 'unreconciled') return err({ code: 'paytr_collection_not_open' })
  const next: PaytrCollection = { ...collection, status: 'reconciled', memberId, paymentId, reconciledBy: ctx.actor, reconciledAt: ctx.now }
  return ok({
    next,
    events: [{ ...base(ctx, 'paytr_collection', collection.id, null, { memberId }), type: PAYTR_COLLECTION_RECONCILED, payload: { collectionId: collection.id, memberId, paymentId } }],
  })
}

export function decideCancelCollection(
  ctx: DecideContext,
  collection: PaytrCollection,
  reason: string,
): Result<Outcome<PaytrCollection>, DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  if (collection.status !== 'unreconciled') return err({ code: 'paytr_collection_not_open' })
  return ok({
    next: { ...collection, status: 'cancelled' },
    events: [{ ...base(ctx, 'paytr_collection', collection.id, null, {}), type: PAYTR_COLLECTION_CANCELLED, payload: { collectionId: collection.id, reason } }],
  })
}
