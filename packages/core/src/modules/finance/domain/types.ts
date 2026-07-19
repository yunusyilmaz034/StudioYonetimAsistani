import type {
  ActorRef,
  BranchId,
  EntitlementId,
  Instant,
  MemberId,
  Money,
  ProductId,
  StudioId,
} from '../../../shared'

// ── THE MONEY LEDGER (v1.24, Doc 26). ───────────────────────────────────────────────────────
//
// Every requirement on the owner's list — cari hesap, borç/alacak, kısmi ödeme, ödeme planı, iade,
// kupon, gift card, gün sonu, kasa, prim — is the same shape: **a movement of value between two
// parties, at a moment, for a reason, attributable to a person.** One model answers all of them;
// nineteen fields on an entitlement answered none.
//
// The arithmetic is append-only, exactly like the credit ledger (Doc 2):
//
//   sale.balanceDue  = total − Σ allocations(sale)
//   memberBalance    = Σ sales.total − Σ allocations − Σ refundsBackToMember
//   payment.unallocated = amount − Σ allocations(payment)
//
// Nothing is stored that cannot be re-derived from the movements (owner's principle 1). The
// denormalised copies below exist for QUERYING, are written in the same transaction as the movement
// that changed them, and have a rebuild path.

export type SaleStatus = 'open' | 'settled' | 'cancelled'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'credit_card' | 'pos' | 'online' | 'gift_card' | 'wallet'

// ── Member WALLET (Doc 27). One per member. `balance` is DERIVED from the wallet events (topups −
//    purchases ± adjustments…), denormalised here for a one-read balance and rebuildable at any time.
//    The decision functions load it to enforce I-37 (never spent below zero). Money is kuruş. ──
export interface Wallet {
  readonly id: string // wal_{memberId} — stable, one per member
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly balance: Money
  readonly updatedAt: Instant
}

// The wallet id is DERIVED from the member id — one wallet per member, addressable without a query.
export const walletIdFor = (memberId: MemberId): string => `wal_${memberId}`
export type DiscountReason = 'campaign' | 'coupon' | 'referral' | 'gift' | 'manual'

// A discount is an AMOUNT, stamped at sale time — never a percentage re-evaluated later (I-34).
// The same 15 % becomes a different number in 2027 the day a rounding rule moves; the kuruş it was
// worth on the day of sale does not.
export interface Discount {
  readonly reason: DiscountReason
  readonly amount: Money
  readonly note: string // mandatory for `manual` (I-36) — a discount without a reason is a hole
  readonly couponCode: string | null
  readonly referredByMemberId: MemberId | null
  readonly grantedBy: ActorRef
}

export interface SaleLine {
  readonly productId: ProductId | null // null ⇒ a non-catalogue line (a gift card, a fee)
  readonly description: string
  readonly quantity: number
  readonly unitPrice: Money
  // What the line GRANTED, once it was granted. The join that lets a package point back at the money
  // that bought it — and vice versa.
  readonly entitlementId: EntitlementId | null
  readonly giftCardId: string | null
}

export interface Sale {
  readonly id: string
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly memberId: MemberId
  readonly lines: readonly SaleLine[]
  readonly discounts: readonly Discount[]
  readonly gross: Money // Σ lines
  readonly total: Money // gross − Σ discounts  (never below zero — I-33)
  readonly paid: Money // denormalised Σ allocations; the allocations remain the truth
  readonly status: SaleStatus
  // ATTRIBUTION (Doc 26 §2). Captured from the first sale, even though commissions are not built
  // yet: if the sale does not record who sold it, no later engineering recovers it.
  readonly soldBy: ActorRef
  readonly soldAt: Instant
  readonly cancelledAt: Instant | null
  readonly cancelReason: string | null
}

export interface Payment {
  readonly id: string
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly memberId: MemberId
  readonly amount: Money
  readonly method: PaymentMethod
  readonly receivedAt: Instant // the CASH-BASIS date — revenue is recognised here (owner, OQ-2)
  readonly takenBy: ActorRef
  readonly drawerId: string | null // cash/pos land in a drawer; a transfer does not
  readonly providerRef: string | null // the seam for İyzico/POS (Doc 26 §9)
  readonly giftCardId: string | null // when the method is a gift card, WHICH card paid
  readonly allocated: Money // denormalised Σ allocations(payment)
  readonly voided: boolean // I-31: a payment is never mutated; a mistake is voided
  readonly voidReason: string | null
  readonly note: string | null
}

// The join that makes partial payment expressible at all: a payment may settle two sales, a sale may
// take five payments.
export interface Allocation {
  readonly id: string
  readonly studioId: StudioId
  readonly paymentId: string
  readonly saleId: string
  readonly memberId: MemberId
  readonly amount: Money
  readonly at: Instant
  readonly by: ActorRef
  readonly reversed: boolean
}

export interface Refund {
  readonly id: string
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly paymentId: string | null // the payment being given back, when there is one
  readonly amount: Money
  readonly method: PaymentMethod
  readonly reason: string // mandatory (I-36)
  readonly at: Instant
  readonly by: ActorRef
  readonly drawerId: string | null
}

// ── Shareable PAYTR payment links + unattributed collections (PF-37) ─────────────────────────
//
// A studio shares a link on Instagram/WhatsApp for a fixed amount ("Fitness 3 Aylık — 9.000 ₺, 3
// taksit"). Anyone can pay it — there is NO member and NO sale yet. So it deliberately sits OUTSIDE
// the ledger (Payment/Sale hard-require a member, and we never weaken that invariant): the money lands
// as a `PaytrCollection` in an "unreconciled" inbox, and reception later ATTRIBUTES it to a member —
// selling the package with the collection's card payment — which is where the real ledger entry is born.
export interface PaymentLink {
  readonly id: string
  readonly studioId: StudioId
  readonly label: string // "Fitness 3 Aylık" — shown on the public page; not a product reference
  readonly amount: Money
  readonly maxInstallments: number // 1 = tek çekim
  readonly active: boolean
  readonly createdBy: ActorRef
  readonly createdAt: Instant
}

export type PaytrCollectionStatus = 'unreconciled' | 'reconciled' | 'cancelled'

export interface PaytrCollection {
  readonly id: string
  readonly studioId: StudioId
  readonly linkId: string
  readonly amount: Money
  readonly installments: number
  // Buyer identity, collected on OUR public page (never from the callback). PII — lives here in state,
  // never in an event payload (#6). Until reconciled she is not a member; this is a lead's contact.
  readonly buyerName: string
  readonly buyerPhone: string // normalised E.164
  readonly providerRef: string // PAYTR merchant_oid — the card ref, carried onto the ledger on reconcile
  readonly paidAt: Instant
  readonly status: PaytrCollectionStatus
  // Set on reconcile: who she turned out to be, and the ledger payment the money became.
  readonly memberId: MemberId | null
  readonly paymentId: string | null
  readonly reconciledBy: ActorRef | null
  readonly reconciledAt: Instant | null
}

// ── the kasa (owner, OQ-5: per branch, per shift) ───────────────────────────────────────────
export type DrawerStatus = 'open' | 'closed'

export interface CashDrawer {
  readonly id: string
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly name: string // 'Merkez Kasa', 'POS'
  readonly kind: 'cash' | 'pos'
  // Archived tills are kept (history references them) but can no longer be opened or take a sale — a
  // mislabelled/duplicate till is retired, never deleted (PF-15). Legacy docs without the field are active.
  readonly active: boolean
  readonly status: DrawerStatus
  readonly openingFloat: Money
  readonly expected: Money // opening + cash in − cash out; derived, denormalised for the screen
  readonly openedAt: Instant | null
  readonly openedBy: ActorRef | null
  readonly closedAt: Instant | null
  readonly closedBy: ActorRef | null
  readonly countedAmount: Money | null // what a human actually counted
  readonly discrepancy: Money | null // counted − expected. RECORDED, never absorbed.
  readonly closeNote: string | null
}

// ── gift cards: a LIABILITY, not a discount (owner, decision 3) ─────────────────────────────
// Sold as a sale (money in, no revenue yet); spent as a payment method. Revenue is recognised when
// it is SPENT. Its balance is an append-only ledger with its own invariant (I-35).
export interface GiftCard {
  readonly id: string
  readonly studioId: StudioId
  readonly code: string
  readonly issuedValue: Money
  readonly redeemed: Money
  readonly expired: Money
  readonly validUntil: Instant | null
  readonly issuedToMemberId: MemberId | null
  readonly issuedAt: Instant
  readonly issuedBy: ActorRef
  readonly saleId: string | null // the sale that sold it
  readonly active: boolean
}

export const giftCardRemaining = (g: GiftCard): number =>
  g.issuedValue.amount - g.redeemed.amount - g.expired.amount

// ── coupons & campaigns: DATA, never code (AD-41). Nothing in a source file knows 15 %. ─────
export type CouponKind = 'percent' | 'amount'

export interface Coupon {
  readonly id: string
  readonly studioId: StudioId
  readonly code: string
  readonly kind: CouponKind
  readonly value: number // percent (1–100) OR kuruş, per `kind`
  readonly validFrom: Instant
  readonly validUntil: Instant
  readonly maxRedemptions: number | null
  readonly redemptions: number
  readonly active: boolean
  readonly note: string | null
}

// ── payment plan: an instalment is a PROMISE, not a payment. It never touches the ledger until
//    money actually moves (that is what makes "bekleyen ödemeler" honest). ────────────────────
export type InstalmentStatus = 'due' | 'paid' | 'overdue' | 'cancelled'

export interface Instalment {
  readonly seq: number
  readonly dueAt: Instant
  readonly amount: Money
  readonly status: InstalmentStatus
  readonly paymentId: string | null
}

export interface PaymentPlan {
  readonly id: string
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly saleId: string
  readonly instalments: readonly Instalment[]
  readonly createdAt: Instant
  readonly createdBy: ActorRef
  readonly cancelled: boolean
}

// ── the derivations. The balance can never be WRONG — only a movement can. ──────────────────
export const saleBalanceDue = (s: Sale): number =>
  s.status === 'cancelled' ? 0 : Math.max(0, s.total.amount - s.paid.amount)

export const paymentUnallocated = (p: Payment): number =>
  p.voided ? 0 : Math.max(0, p.amount.amount - p.allocated.amount)

// Cari hesap. Positive ⇒ the member owes the studio; negative ⇒ the studio holds her money
// (an over-payment is member credit, never a negative sale — I-33).
export function memberBalance(
  sales: readonly Sale[],
  payments: readonly Payment[],
  refunds: readonly Refund[],
): number {
  const owed = sales
    .filter((s) => s.status !== 'cancelled')
    .reduce((n, s) => n + s.total.amount, 0)
  const paid = payments.filter((p) => !p.voided).reduce((n, p) => n + p.amount.amount, 0)
  const refunded = refunds.reduce((n, r) => n + r.amount.amount, 0)
  return owed - paid + refunded
}
