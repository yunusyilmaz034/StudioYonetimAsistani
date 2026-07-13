import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type MemberId,
  type NewEvent,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { FinanceRepository, FinanceWrite } from '../application/ports'
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

// Timestamps in, millis out — the same convention as every other repository. Money is stored as the
// `{ amount, currency }` object it is (#10): never a float, never a bare number that a later reader
// could mistake for lira.
const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

const saleTo = (s: Sale): DocumentData => ({
  ...s,
  soldAt: ts(s.soldAt),
  cancelledAt: s.cancelledAt ? ts(s.cancelledAt) : null,
})
const saleFrom = (id: string, d: DocumentData): Sale => ({
  ...(d as Sale),
  id,
  soldAt: instant(ms(d.soldAt)),
  cancelledAt: d.cancelledAt ? instant(ms(d.cancelledAt)) : null,
})

const paymentTo = (p: Payment): DocumentData => ({ ...p, receivedAt: ts(p.receivedAt) })
const paymentFrom = (id: string, d: DocumentData): Payment => ({
  ...(d as Payment),
  id,
  receivedAt: instant(ms(d.receivedAt)),
})

const allocationTo = (a: Allocation): DocumentData => ({ ...a, at: ts(a.at) })
const allocationFrom = (id: string, d: DocumentData): Allocation => ({
  ...(d as Allocation),
  id,
  at: instant(ms(d.at)),
})

const refundTo = (r: Refund): DocumentData => ({ ...r, at: ts(r.at) })
const refundFrom = (id: string, d: DocumentData): Refund => ({
  ...(d as Refund),
  id,
  at: instant(ms(d.at)),
})

const drawerTo = (x: CashDrawer): DocumentData => ({
  ...x,
  openedAt: x.openedAt ? ts(x.openedAt) : null,
  closedAt: x.closedAt ? ts(x.closedAt) : null,
})
const drawerFrom = (id: string, d: DocumentData): CashDrawer => ({
  ...(d as CashDrawer),
  id,
  openedAt: d.openedAt ? instant(ms(d.openedAt)) : null,
  closedAt: d.closedAt ? instant(ms(d.closedAt)) : null,
})

const cardTo = (g: GiftCard): DocumentData => ({
  ...g,
  issuedAt: ts(g.issuedAt),
  validUntil: g.validUntil ? ts(g.validUntil) : null,
})
const cardFrom = (id: string, d: DocumentData): GiftCard => ({
  ...(d as GiftCard),
  id,
  issuedAt: instant(ms(d.issuedAt)),
  validUntil: d.validUntil ? instant(ms(d.validUntil)) : null,
})

const couponTo = (c: Coupon): DocumentData => ({
  ...c,
  validFrom: ts(c.validFrom),
  validUntil: ts(c.validUntil),
})
const couponFrom = (id: string, d: DocumentData): Coupon => ({
  ...(d as Coupon),
  id,
  validFrom: instant(ms(d.validFrom)),
  validUntil: instant(ms(d.validUntil)),
})

const planTo = (p: PaymentPlan): DocumentData => ({
  ...p,
  createdAt: ts(p.createdAt),
  instalments: p.instalments.map((i) => ({ ...i, dueAt: ts(i.dueAt) })),
})
const planFrom = (id: string, d: DocumentData): PaymentPlan => ({
  ...(d as PaymentPlan),
  id,
  createdAt: instant(ms(d.createdAt)),
  instalments: ((d.instalments as DocumentData[]) ?? []).map((i) => ({
    ...(i as PaymentPlan['instalments'][number]),
    dueAt: instant(ms(i.dueAt)),
  })),
})

export class FirestoreFinanceRepository implements FinanceRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }
  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.col(sid, 'events').doc(newEventId()), {
        ...e,
        occurredAt: ts(e.occurredAt),
        recordedAt: Timestamp.now(),
      })
    }
  }

  async getSale(ctx: TenantContext, id: string): Promise<Sale | null> {
    const s = await this.col(ctx.studioId, 'sales').doc(id).get()
    const d = s.data()
    return d ? saleFrom(id, d) : null
  }
  async listSalesByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Sale[]> {
    const snap = await this.col(ctx.studioId, 'sales').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => saleFrom(d.id, d.data())).sort((a, b) => b.soldAt - a.soldAt)
  }
  async listOpenSales(ctx: TenantContext): Promise<readonly Sale[]> {
    const snap = await this.col(ctx.studioId, 'sales').where('status', '==', 'open').get()
    return snap.docs.map((d) => saleFrom(d.id, d.data())).sort((a, b) => a.soldAt - b.soldAt)
  }

  async getPayment(ctx: TenantContext, id: string): Promise<Payment | null> {
    const s = await this.col(ctx.studioId, 'payments').doc(id).get()
    const d = s.data()
    return d ? paymentFrom(id, d) : null
  }
  async listPaymentsByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Payment[]> {
    const snap = await this.col(ctx.studioId, 'payments').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => paymentFrom(d.id, d.data())).sort((a, b) => b.receivedAt - a.receivedAt)
  }
  async listPaymentsBetween(ctx: TenantContext, fromMs: number, toMs: number): Promise<readonly Payment[]> {
    const snap = await this.col(ctx.studioId, 'payments')
      .where('receivedAt', '>=', ts(fromMs))
      .where('receivedAt', '<=', ts(toMs))
      .get()
    return snap.docs.map((d) => paymentFrom(d.id, d.data()))
  }
  async listAllocationsByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Allocation[]> {
    const snap = await this.col(ctx.studioId, 'allocations').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => allocationFrom(d.id, d.data()))
  }
  async listRefundsByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Refund[]> {
    const snap = await this.col(ctx.studioId, 'refunds').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => refundFrom(d.id, d.data()))
  }

  async getDrawer(ctx: TenantContext, id: string): Promise<CashDrawer | null> {
    const s = await this.col(ctx.studioId, 'cashDrawers').doc(id).get()
    const d = s.data()
    return d ? drawerFrom(id, d) : null
  }
  async listDrawers(ctx: TenantContext): Promise<readonly CashDrawer[]> {
    const snap = await this.col(ctx.studioId, 'cashDrawers').get()
    return snap.docs.map((d) => drawerFrom(d.id, d.data()))
  }
  async saveDrawer(ctx: TenantContext, drawer: CashDrawer, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'cashDrawers').doc(drawer.id), drawerTo(drawer))
      this.writeEvents(sid, tx, events)
    })
  }

  async getGiftCardByCode(ctx: TenantContext, code: string): Promise<GiftCard | null> {
    const snap = await this.col(ctx.studioId, 'giftCards').where('code', '==', code).limit(1).get()
    const doc = snap.docs[0]
    return doc ? cardFrom(doc.id, doc.data()) : null
  }
  async getGiftCard(ctx: TenantContext, id: string): Promise<GiftCard | null> {
    const s = await this.col(ctx.studioId, 'giftCards').doc(id).get()
    const d = s.data()
    return d ? cardFrom(id, d) : null
  }
  async listGiftCards(ctx: TenantContext): Promise<readonly GiftCard[]> {
    const snap = await this.col(ctx.studioId, 'giftCards').get()
    return snap.docs.map((d) => cardFrom(d.id, d.data()))
  }
  async getCouponByCode(ctx: TenantContext, code: string): Promise<Coupon | null> {
    const snap = await this.col(ctx.studioId, 'coupons').where('code', '==', code).limit(1).get()
    const doc = snap.docs[0]
    return doc ? couponFrom(doc.id, doc.data()) : null
  }
  async listCoupons(ctx: TenantContext): Promise<readonly Coupon[]> {
    const snap = await this.col(ctx.studioId, 'coupons').get()
    return snap.docs.map((d) => couponFrom(d.id, d.data()))
  }
  async saveCoupon(ctx: TenantContext, coupon: Coupon, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'coupons').doc(coupon.id), couponTo(coupon))
      this.writeEvents(sid, tx, events)
    })
  }

  async listPlansByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly PaymentPlan[]> {
    const snap = await this.col(ctx.studioId, 'paymentPlans').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => planFrom(d.id, d.data()))
  }
  async listOpenPlans(ctx: TenantContext): Promise<readonly PaymentPlan[]> {
    const snap = await this.col(ctx.studioId, 'paymentPlans').where('cancelled', '==', false).get()
    return snap.docs.map((d) => planFrom(d.id, d.data()))
  }

  // ONE transaction. The sale, the payment, the allocation, the drawer's expected balance, the
  // gift-card ledger and every event they emit commit together (#1) — a finance module whose parts
  // can drift is a finance module that will drift, and nobody will notice until the gün sonu.
  async commit(ctx: TenantContext, write: FinanceWrite): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      for (const s of write.sales ?? []) tx.set(this.col(sid, 'sales').doc(s.id), saleTo(s))
      for (const p of write.payments ?? []) tx.set(this.col(sid, 'payments').doc(p.id), paymentTo(p))
      for (const a of write.allocations ?? [])
        tx.set(this.col(sid, 'allocations').doc(a.id), allocationTo(a))
      for (const r of write.refunds ?? []) tx.set(this.col(sid, 'refunds').doc(r.id), refundTo(r))
      for (const d of write.drawers ?? []) tx.set(this.col(sid, 'cashDrawers').doc(d.id), drawerTo(d))
      for (const g of write.giftCards ?? []) tx.set(this.col(sid, 'giftCards').doc(g.id), cardTo(g))
      for (const c of write.coupons ?? []) tx.set(this.col(sid, 'coupons').doc(c.id), couponTo(c))
      for (const p of write.plans ?? []) tx.set(this.col(sid, 'paymentPlans').doc(p.id), planTo(p))
      this.writeEvents(sid, tx, write.events)
    })
  }
}
