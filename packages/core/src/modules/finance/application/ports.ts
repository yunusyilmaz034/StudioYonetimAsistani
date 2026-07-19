import type { Clock, EventSource, MemberId, NewEvent, TenantContext } from '../../../shared'
import type {
  Allocation,
  CashDrawer,
  Coupon,
  GiftCard,
  Payment,
  PaymentPlan,
  Refund,
  Sale,
  Wallet,
} from '../domain/types'

export interface FinanceRepository {
  getSale(ctx: TenantContext, id: string): Promise<Sale | null>
  listSalesByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Sale[]>
  listOpenSales(ctx: TenantContext): Promise<readonly Sale[]> // "bekleyen ödemeler"
  // The sales report reads by the date the sale was AGREED, not the date it was paid — the two are
  // different questions and answering one with the other is how a studio believes it had a good month.
  listSalesBetween(ctx: TenantContext, fromMs: number, toMs: number): Promise<readonly Sale[]>
  getPayment(ctx: TenantContext, id: string): Promise<Payment | null>
  listPaymentsByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Payment[]>
  listPaymentsBetween(ctx: TenantContext, fromMs: number, toMs: number): Promise<readonly Payment[]>
  listAllocationsByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Allocation[]>
  listRefundsByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Refund[]>

  getDrawer(ctx: TenantContext, id: string): Promise<CashDrawer | null>
  listDrawers(ctx: TenantContext): Promise<readonly CashDrawer[]>
  saveDrawer(ctx: TenantContext, drawer: CashDrawer, events: readonly NewEvent[]): Promise<void>

  getGiftCardByCode(ctx: TenantContext, code: string): Promise<GiftCard | null>
  getGiftCard(ctx: TenantContext, id: string): Promise<GiftCard | null>
  listGiftCards(ctx: TenantContext): Promise<readonly GiftCard[]>
  getCouponByCode(ctx: TenantContext, code: string): Promise<Coupon | null>
  listCoupons(ctx: TenantContext): Promise<readonly Coupon[]>
  saveCoupon(ctx: TenantContext, coupon: Coupon, events: readonly NewEvent[]): Promise<void>

  listPlansByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly PaymentPlan[]>
  listOpenPlans(ctx: TenantContext): Promise<readonly PaymentPlan[]> // "yaklaşan tahsilatlar"

  // The member wallet. `null` before its first topup — the wallet is born the first time money lands.
  getWallet(ctx: TenantContext, walletId: string): Promise<Wallet | null>
  getWalletByMember(ctx: TenantContext, memberId: MemberId): Promise<Wallet | null>

  // The sale, the payment, the allocation, the drawer's expected balance, the gift-card ledger and
  // every event they emit commit TOGETHER (#1). A finance module whose parts can drift is a finance
  // module that will drift.
  commit(ctx: TenantContext, write: FinanceWrite): Promise<void>
}

// Everything one financial act touches. Nothing here is optional out of laziness: each field is a
// document that a single act may legitimately move.
/**
 * A movement of cash in or out of a till (Alpha stress test, 2026-07-13).
 *
 * It is a DELTA, not a document — and that distinction is the whole bug it fixes.
 *
 * The drawer used to be read OUTSIDE the transaction, its `expected` recomputed in memory, and the
 * whole document written back. Firestore only serialises on documents read INSIDE a transaction, so
 * twelve concurrent cash payments each read `expected = 0` and each wrote `expected = 3.000` —
 * last-write-wins. **Eleven payments' cash vanished from the till.** The money was in the ledger, the
 * receipts were correct, and the day-end count came up 33.000 ₺ short with nothing to explain it.
 *
 * The repository now re-reads the drawer inside the transaction and applies the delta there, so the
 * till is a counter under contention rather than a document in a race.
 */
export interface DrawerDelta {
  readonly drawerId: string
  /** Signed kuruş. Positive: money in. Negative: a void or a refund taking it back out. */
  readonly deltaKurus: number
}

/**
 * A movement on a member's wallet — a signed DELTA, applied to the balance INSIDE the transaction,
 * for the same reason the drawer is (above): the balance is a counter under contention, not a
 * document in a race. Two concurrent purchases must serialise, or a wallet with 100 ₺ pays 200.
 *
 * `refuseBelowZero` (true for every debit) makes I-37 hold at the serialisation point: the repo
 * re-reads the balance in the transaction and ABORTS if the delta would cross zero — the domain's
 * load-time check is only the first line of defence. The txn also stamps the AUTHORITATIVE
 * `balanceAfter` onto `event` before writing it, so the immutable log never records a stale balance.
 */
export interface WalletApply {
  readonly walletId: string
  readonly memberId: MemberId
  readonly deltaKurus: number // signed: positive in, negative out
  readonly refuseBelowZero: boolean
  readonly event: NewEvent // its payload.balanceAfter is overwritten with the in-transaction value
}

export interface FinanceWrite {
  readonly sales?: readonly Sale[]
  readonly payments?: readonly Payment[]
  readonly allocations?: readonly Allocation[]
  readonly refunds?: readonly Refund[]
  readonly drawerDeltas?: readonly DrawerDelta[]
  readonly giftCards?: readonly GiftCard[]
  readonly coupons?: readonly Coupon[]
  readonly plans?: readonly PaymentPlan[]
  readonly walletApplies?: readonly WalletApply[]
  readonly events: readonly NewEvent[]
}

export interface FinanceDeps {
  readonly repo: FinanceRepository
  readonly clock: Clock
  // The event's `source` — who or what produced this act. Defaults to `reception_web`, because that
  // is what almost always did. The MIGRATION overrides it: a historical sale generated by an import
  // script that stamped `reception_web` would be a falsehood written into an immutable log, and the
  // log is the one place we can never go back and correct (#2 — the producer is never guessed).
  readonly source?: EventSource
}
