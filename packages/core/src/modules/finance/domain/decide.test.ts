import { describe, expect, it } from 'vitest'

import {
  decideAllocate,
  decideCancelSale,
  decideCloseDrawer,
  decideCreatePlan,
  decideCreateSale,
  decideOpenDrawer,
  decideReceivePayment,
  decideRefund,
  decideVoidPayment,
  couponDiscount,
  type DecideContext,
} from './decide'
import {
  giftCardRemaining,
  memberBalance,
  paymentUnallocated,
  saleBalanceDue,
  type CashDrawer,
  type Coupon,
  type GiftCard,
  type Payment,
  type PaymentPlan,
  type Sale,
} from './types'
import {
  instant,
  money,
  zeroMoney,
  type ActorRef,
  type BranchId,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../../shared'

const NOW = instant(1_700_000_000_000)
const DAY = 86_400_000
const RECEPTION: ActorRef = { type: 'receptionist', id: 'usr_1' as StaffUserId }
const OWNER: ActorRef = { type: 'owner', id: 'usr_o' as StaffUserId }

const ctx = (actor: ActorRef = RECEPTION): DecideContext => ({
  studioId: 'std_1' as StudioId,
  actor,
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
})

const line = (unit: number, qty = 1) => ({
  productId: 'prd_1' as never,
  description: 'Reformer 8 Ders',
  quantity: qty,
  unitPrice: money(unit),
  entitlementId: null,
  giftCardId: null,
})

const saleInput = (over: Partial<Parameters<typeof decideCreateSale>[1]> = {}) => ({
  saleId: 'sal_1',
  memberId: 'mem_1' as MemberId,
  branchId: 'brn_1' as BranchId,
  lines: [line(500_000)],
  discounts: [],
  discountCeilingPercent: null,
  ...over,
})

const sale = (over: Partial<Sale> = {}): Sale => {
  const r = decideCreateSale(ctx(), saleInput())
  if (!r.ok) throw new Error('fixture')
  return { ...r.value.next, ...over }
}

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'pay_1',
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  memberId: 'mem_1' as MemberId,
  amount: money(200_000),
  method: 'bank_transfer',
  receivedAt: NOW,
  takenBy: RECEPTION,
  drawerId: null,
  providerRef: null,
  giftCardId: null,
  allocated: zeroMoney(),
  voided: false,
  voidReason: null,
  note: null,
  ...over,
})

const drawer = (over: Partial<CashDrawer> = {}): CashDrawer => ({
  id: 'drw_1',
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as BranchId,
  name: 'Merkez Kasa',
  kind: 'cash',
  status: 'closed',
  openingFloat: zeroMoney(),
  expected: zeroMoney(),
  openedAt: null,
  openedBy: null,
  closedAt: null,
  closedBy: null,
  countedAmount: null,
  discrepancy: null,
  closeNote: null,
  ...over,
})

const card = (over: Partial<GiftCard> = {}): GiftCard => ({
  id: 'gft_1',
  studioId: 'std_1' as StudioId,
  code: 'HEDIYE100',
  issuedValue: money(100_000),
  redeemed: zeroMoney(),
  expired: zeroMoney(),
  validUntil: null,
  issuedToMemberId: null,
  issuedAt: NOW,
  issuedBy: RECEPTION,
  saleId: null,
  active: true,
  ...over,
})

describe('sale (v1.24)', () => {
  it('creates a sale, nets the discount, and records WHO sold it', () => {
    const r = decideCreateSale(
      ctx(),
      saleInput({
        discounts: [
          {
            reason: 'campaign',
            amount: money(50_000),
            note: 'Yaz kampanyası',
            couponCode: null,
            referredByMemberId: null,
            grantedBy: RECEPTION,
          },
        ],
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.gross.amount).toBe(500_000)
    expect(r.value.next.total.amount).toBe(450_000)
    // Attribution cannot be retrofitted: if the sale does not say who sold it, nothing recovers it.
    expect(r.value.next.soldBy).toEqual(RECEPTION)
    expect(r.value.events[0]?.type).toBe('sale.created')
  })

  it('refuses a manual discount with no reason (I-36)', () => {
    const r = decideCreateSale(
      ctx(),
      saleInput({
        discounts: [
          { reason: 'manual', amount: money(50_000), note: '  ', couponCode: null, referredByMemberId: null, grantedBy: RECEPTION },
        ],
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('reason_required')
  })

  it('refuses a discount above the studio ceiling — unless the OWNER gives it', () => {
    const big = [
      { reason: 'manual' as const, amount: money(300_000), note: 'Özel', couponCode: null, referredByMemberId: null, grantedBy: RECEPTION },
    ]
    const byReception = decideCreateSale(ctx(RECEPTION), saleInput({ discounts: big, discountCeilingPercent: 20 }))
    expect(byReception.ok).toBe(false)
    if (!byReception.ok) expect(byReception.error.code).toBe('discount_exceeds_ceiling')

    const byOwner = decideCreateSale(ctx(OWNER), saleInput({ discounts: big, discountCeilingPercent: 20 }))
    expect(byOwner.ok).toBe(true)
  })

  it('a sale never goes below zero (I-33): an over-discount is refused, not a negative sale', () => {
    const r = decideCreateSale(
      ctx(OWNER),
      saleInput({
        discounts: [
          { reason: 'manual', amount: money(600_000), note: 'x', couponCode: null, referredByMemberId: null, grantedBy: OWNER },
        ],
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('invalid_adjustment')
  })

  it('cancelling a sale needs a reason, and carries the amount so revenue can go net', () => {
    expect(decideCancelSale(ctx(), sale(), '  ').ok).toBe(false)
    const r = decideCancelSale(ctx(), sale(), 'Üye vazgeçti')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('cancelled')
    expect(r.value.events[0]?.payload).toMatchObject({ total: { amount: 500_000 } })
  })
})

describe('payment (v1.24)', () => {
  it('a cash payment REQUIRES an open kasa', () => {
    const noDrawer = decideReceivePayment(ctx(), input({ method: 'cash', drawerId: null }), null, null)
    expect(noDrawer.ok).toBe(false)
    if (!noDrawer.ok) expect(noDrawer.error.code).toBe('drawer_required')

    const closed = decideReceivePayment(ctx(), input({ method: 'cash', drawerId: 'drw_1' }), drawer(), null)
    expect(closed.ok).toBe(false)
    if (!closed.ok) expect(closed.error.code).toBe('drawer_not_open')

    const open = decideReceivePayment(
      ctx(),
      input({ method: 'cash', drawerId: 'drw_1' }),
      drawer({ status: 'open' }),
      null,
    )
    expect(open.ok).toBe(true)
  })

  it('a gift card cannot be spent below zero — refused, never clamped (I-35)', () => {
    const r = decideReceivePayment(
      ctx(),
      input({ method: 'gift_card', amount: money(150_000), giftCardId: 'gft_1' }),
      null,
      card(),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('giftcard_insufficient')
  })

  it('spending a gift card writes the redemption AND its remaining balance', () => {
    const r = decideReceivePayment(
      ctx(),
      input({ method: 'gift_card', amount: money(40_000), giftCardId: 'gft_1' }),
      null,
      card(),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const redeemed = r.value.events.find((e) => e.type === 'giftcard.redeemed')
    expect(redeemed?.payload).toMatchObject({ remainingAfter: { amount: 60_000 } })
  })

  it('a payment is NEVER mutated — a mistake is voided, with a reason (I-31)', () => {
    expect(decideVoidPayment(ctx(), payment(), '   ').ok).toBe(false)
    const r = decideVoidPayment(ctx(), payment(), 'Yanlış tutar girildi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.voided).toBe(true)
    expect(r.value.next.amount.amount).toBe(200_000) // the amount is untouched — history is not edited
    expect(decideVoidPayment(ctx(), r.value.next, 'tekrar').ok).toBe(false)
  })

  it('a refund needs a reason and cannot exceed the payment', () => {
    expect(decideRefund(ctx(), payment(), money(300_000), 'x', 'ref_1').ok).toBe(false)
    expect(decideRefund(ctx(), payment(), money(50_000), '  ', 'ref_1').ok).toBe(false)
    const r = decideRefund(ctx(), payment(), money(50_000), 'İade talebi', 'ref_1')
    expect(r.ok).toBe(true)
  })
})

describe('allocation — what makes partial payment expressible (v1.24)', () => {
  it('settles a sale in two payments, and the sale closes on the second', () => {
    const s = sale()
    const first = decideAllocate(ctx(), payment({ amount: money(200_000) }), s, money(200_000), 'alc_1')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(saleBalanceDue(first.value.next.sale)).toBe(300_000)
    expect(first.value.next.sale.status).toBe('open')

    const second = decideAllocate(
      ctx(),
      payment({ id: 'pay_2', amount: money(300_000) }),
      first.value.next.sale,
      money(300_000),
      'alc_2',
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(saleBalanceDue(second.value.next.sale)).toBe(0)
    expect(second.value.next.sale.status).toBe('settled')
    expect(second.value.events.map((e) => e.type)).toContain('sale.settled')
  })

  it('a payment can never pay more than it is worth (I-32)', () => {
    const r = decideAllocate(ctx(), payment({ amount: money(100_000) }), sale(), money(150_000), 'alc_1')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('allocation_exceeds_payment')
  })

  it('a sale can never take more than it is owed — the surplus stays as member credit (I-33)', () => {
    const r = decideAllocate(ctx(), payment({ amount: money(900_000) }), sale(), money(900_000), 'alc_1')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('allocation_exceeds_sale')
  })

  it('refuses to allocate a voided payment or pay a cancelled sale', () => {
    expect(decideAllocate(ctx(), payment({ voided: true }), sale(), money(10_000), 'a').ok).toBe(false)
    expect(decideAllocate(ctx(), payment(), sale({ status: 'cancelled' }), money(10_000), 'a').ok).toBe(false)
  })

  it('the ledger derives the balances — nothing is stored that cannot be re-derived', () => {
    const p = payment({ amount: money(200_000), allocated: money(120_000) })
    expect(paymentUnallocated(p)).toBe(80_000)
    expect(giftCardRemaining(card({ redeemed: money(30_000) }))).toBe(70_000)
    // Cari hesap: sold 500.000, paid 200.000, refunded 50.000 → owes 350.000
    expect(
      memberBalance(
        [sale()],
        [payment({ amount: money(200_000) })],
        [
          {
            id: 'ref_1',
            studioId: 'std_1' as StudioId,
            memberId: 'mem_1' as MemberId,
            paymentId: 'pay_1',
            amount: money(50_000),
            method: 'cash',
            reason: 'x',
            at: NOW,
            by: RECEPTION,
            drawerId: null,
          },
        ],
      ),
    ).toBe(350_000)
  })
})

describe('kasa & gün sonu (v1.24)', () => {
  it('opens, then refuses to open twice', () => {
    const opened = decideOpenDrawer(ctx(), drawer(), money(50_000))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.next.expected.amount).toBe(50_000)
    expect(decideOpenDrawer(ctx(), opened.value.next, money(0)).ok).toBe(false)
  })

  it('a discrepancy is RECORDED, never absorbed — and it demands an explanation', () => {
    const open = drawer({ status: 'open', expected: money(120_000), openingFloat: money(50_000) })
    const silent = decideCloseDrawer(ctx(), open, money(115_000), null)
    expect(silent.ok).toBe(false)
    if (!silent.ok) expect(silent.error.code).toBe('reason_required')

    const r = decideCloseDrawer(ctx(), open, money(115_000), 'Kasa açığı, araştırılıyor')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.discrepancy?.amount).toBe(-5_000)
    expect(r.value.events.map((e) => e.type)).toEqual(['drawer.closed', 'drawer.discrepancy_recorded'])
  })

  it('a clean count closes without a discrepancy event', () => {
    const open = drawer({ status: 'open', expected: money(120_000) })
    const r = decideCloseDrawer(ctx(), open, money(120_000), null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events.map((e) => e.type)).toEqual(['drawer.closed'])
    expect(r.value.next.discrepancy?.amount).toBe(0)
  })
})

describe('payment plan & coupon (v1.24)', () => {
  const plan = (amounts: number[]): PaymentPlan => ({
    id: 'pln_1',
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    saleId: 'sal_1',
    instalments: amounts.map((a, i) => ({
      seq: i + 1,
      dueAt: instant(NOW + (i + 1) * 30 * DAY),
      amount: money(a),
      status: 'due' as const,
      paymentId: null,
    })),
    createdAt: NOW,
    createdBy: RECEPTION,
    cancelled: false,
  })

  it('refuses a plan whose instalments do not add up to the debt', () => {
    const r = decideCreatePlan(ctx(), plan([100_000, 100_000]), sale())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('plan_total_mismatch')
  })

  it('accepts a plan that adds up exactly', () => {
    const r = decideCreatePlan(ctx(), plan([250_000, 250_000]), sale())
    expect(r.ok).toBe(true)
  })

  it('a percentage coupon is rounded to kuruş AT SALE TIME (I-34)', () => {
    const coupon: Coupon = {
      id: 'cpn_1',
      studioId: 'std_1' as StudioId,
      code: 'YAZ15',
      kind: 'percent',
      value: 15,
      validFrom: NOW,
      validUntil: instant(NOW + 30 * DAY),
      maxRedemptions: null,
      redemptions: 0,
      active: true,
      note: null,
    }
    expect(couponDiscount(coupon, money(333_333)).amount).toBe(50_000) // an integer, always
    expect(couponDiscount({ ...coupon, kind: 'amount', value: 900_000 }, money(500_000)).amount).toBe(500_000)
  })
})

function input(over: Partial<Parameters<typeof decideReceivePayment>[1]> = {}) {
  return {
    paymentId: 'pay_1',
    memberId: 'mem_1' as MemberId,
    branchId: 'brn_1' as BranchId,
    amount: money(200_000),
    method: 'cash' as const,
    receivedAt: NOW,
    drawerId: null,
    giftCardId: null,
    providerRef: null,
    note: null,
    ...over,
  }
}
