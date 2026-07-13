import type { Clock, MemberId, NewEvent, TenantContext } from '../../../shared'
import type {
  Allocation,
  CashDrawer,
  Coupon,
  GiftCard,
  Payment,
  PaymentPlan,
  Refund,
  Sale,
} from '../domain/types'

export interface FinanceRepository {
  getSale(ctx: TenantContext, id: string): Promise<Sale | null>
  listSalesByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Sale[]>
  listOpenSales(ctx: TenantContext): Promise<readonly Sale[]> // "bekleyen ödemeler"
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

  // The sale, the payment, the allocation, the drawer's expected balance, the gift-card ledger and
  // every event they emit commit TOGETHER (#1). A finance module whose parts can drift is a finance
  // module that will drift.
  commit(ctx: TenantContext, write: FinanceWrite): Promise<void>
}

// Everything one financial act touches. Nothing here is optional out of laziness: each field is a
// document that a single act may legitimately move.
export interface FinanceWrite {
  readonly sales?: readonly Sale[]
  readonly payments?: readonly Payment[]
  readonly allocations?: readonly Allocation[]
  readonly refunds?: readonly Refund[]
  readonly drawers?: readonly CashDrawer[]
  readonly giftCards?: readonly GiftCard[]
  readonly coupons?: readonly Coupon[]
  readonly plans?: readonly PaymentPlan[]
  readonly events: readonly NewEvent[]
}

export interface FinanceDeps {
  readonly repo: FinanceRepository
  readonly clock: Clock
}
