import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { PaymentLink, PaytrCollection } from '../domain/types'

// PF-37 — repositories for the shareable-link + unattributed-collection aggregates. Separate classes so
// the ledger's `FinanceRepository` interface is untouched (a Payment is still always member-attributed).
// Money round-trips as its own `{ amount, currency }` object (Firestore-native); Instants ↔ Timestamps.

const ts = (m: number): Timestamp => Timestamp.fromMillis(m)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

function writeEvents(db: Firestore, sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
  const events_ = db.collection('studios').doc(sid).collection('events')
  for (const e of events) {
    tx.set(events_.doc(newEventId()), { ...e, occurredAt: ts(e.occurredAt), recordedAt: Timestamp.now() })
  }
}

const linkTo = (x: PaymentLink): DocumentData => ({ ...x, createdAt: ts(x.createdAt) })
const linkFrom = (id: string, d: DocumentData): PaymentLink => ({
  id,
  studioId: d.studioId as StudioId,
  label: d.label as string,
  amount: d.amount as PaymentLink['amount'],
  maxInstallments: d.maxInstallments as number,
  active: d.active as boolean,
  createdBy: d.createdBy as PaymentLink['createdBy'],
  createdAt: instant(ms(d.createdAt)),
})

const collectionTo = (x: PaytrCollection): DocumentData => ({
  ...x,
  paidAt: ts(x.paidAt),
  reconciledAt: x.reconciledAt !== null ? ts(x.reconciledAt) : null,
})
const collectionFrom = (id: string, d: DocumentData): PaytrCollection => ({
  id,
  studioId: d.studioId as StudioId,
  linkId: d.linkId as string,
  amount: d.amount as PaytrCollection['amount'],
  installments: d.installments as number,
  buyerName: (d.buyerName as string) ?? '',
  buyerPhone: (d.buyerPhone as string) ?? '',
  providerRef: d.providerRef as string,
  paidAt: instant(ms(d.paidAt)),
  status: d.status as PaytrCollection['status'],
  memberId: (d.memberId as PaytrCollection['memberId']) ?? null,
  paymentId: (d.paymentId as string | null) ?? null,
  reconciledBy: (d.reconciledBy as PaytrCollection['reconciledBy']) ?? null,
  reconciledAt: d.reconciledAt ? instant(ms(d.reconciledAt)) : null,
})

export class FirestorePaymentLinkRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}
  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('paytrLinks')
  }
  async save(ctx: TenantContext, link: PaymentLink, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(ctx.studioId).doc(link.id), linkTo(link))
      writeEvents(this.db, ctx.studioId, tx, events)
    })
  }
  async get(ctx: TenantContext, id: string): Promise<PaymentLink | null> {
    const s = await this.col(ctx.studioId).doc(id).get()
    const d = s.data()
    return d ? linkFrom(id, d) : null
  }
  async listActive(ctx: TenantContext): Promise<readonly PaymentLink[]> {
    const snap = await this.col(ctx.studioId).where('active', '==', true).get()
    return snap.docs.map((d) => linkFrom(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
}

export class FirestorePaytrCollectionRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}
  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('paytrCollections')
  }
  async save(ctx: TenantContext, collection: PaytrCollection, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(ctx.studioId).doc(collection.id), collectionTo(collection))
      writeEvents(this.db, ctx.studioId, tx, events)
    })
  }
  async get(ctx: TenantContext, id: string): Promise<PaytrCollection | null> {
    const s = await this.col(ctx.studioId).doc(id).get()
    const d = s.data()
    return d ? collectionFrom(id, d) : null
  }
  async listUnreconciled(ctx: TenantContext): Promise<readonly PaytrCollection[]> {
    const snap = await this.col(ctx.studioId).where('status', '==', 'unreconciled').get()
    return snap.docs.map((d) => collectionFrom(d.id, d.data())).sort((a, b) => b.paidAt - a.paidAt)
  }
}
