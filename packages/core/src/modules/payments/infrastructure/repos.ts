import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { PaymentIntentRepository } from '../application/ports'
import type { PaymentIntent } from '../domain/types'

const toTs = (i: number): Timestamp => Timestamp.fromMillis(i)
const fromTs = (t: Timestamp | null): number | null => (t ? t.toMillis() : null)

function toDoc(p: PaymentIntent): DocumentData {
  return {
    studioId: p.studioId,
    memberId: p.memberId,
    saleId: p.saleId,
    purpose: p.purpose,
    amount: p.amount,
    provider: p.provider,
    flow: p.flow,
    providerRef: p.providerRef,
    redirectUrl: p.redirectUrl,
    idempotencyKey: p.idempotencyKey,
    status: p.status,
    context: p.context,
    expiresAt: p.expiresAt === null ? null : toTs(p.expiresAt),
    failureReason: p.failureReason,
    refundedAmount: p.refundedAmount,
    createdBy: p.createdBy,
    createdAt: toTs(p.createdAt),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function fromDoc(id: string, d: DocumentData): PaymentIntent {
  return {
    id,
    studioId: d.studioId as StudioId,
    memberId: d.memberId as string,
    saleId: d.saleId as string,
    purpose: d.purpose,
    amount: d.amount,
    provider: d.provider,
    flow: d.flow,
    providerRef: d.providerRef as string,
    redirectUrl: (d.redirectUrl as string | null) ?? null,
    idempotencyKey: d.idempotencyKey as string,
    status: d.status,
    context: (d.context as PaymentIntent['context']) ?? {},
    expiresAt: (() => {
      const ms = fromTs((d.expiresAt as Timestamp | null) ?? null)
      return ms === null ? null : instant(ms)
    })(),
    failureReason: (d.failureReason as string | null) ?? null,
    refundedAmount: d.refundedAmount,
    createdBy: d.createdBy,
    createdAt: instant(fromTs(d.createdAt as Timestamp) ?? 0),
    updatedAt: instant(fromTs((d.updatedAt as Timestamp | null) ?? null) ?? 0),
  }
}

export class FirestorePaymentIntentRepository implements PaymentIntentRepository {
  constructor(private readonly db: Firestore) {}

  private col(studioId: string) {
    return this.db.collection('studios').doc(studioId).collection('paymentIntents')
  }
  private events(studioId: string) {
    return this.db.collection('studios').doc(studioId).collection('events')
  }

  async getIntent(ctx: TenantContext, id: string): Promise<PaymentIntent | null> {
    const snap = await this.col(ctx.studioId).doc(id).get()
    return snap.exists ? fromDoc(snap.id, snap.data() as DocumentData) : null
  }

  async getIntentByProviderRef(ctx: TenantContext, providerRef: string): Promise<PaymentIntent | null> {
    const snap = await this.col(ctx.studioId).where('providerRef', '==', providerRef).limit(1).get()
    const d = snap.docs[0]
    return d ? fromDoc(d.id, d.data()) : null
  }

  // State doc + events, atomically — the ledger discipline (#1).
  async saveIntent(ctx: TenantContext, intent: PaymentIntent, events: readonly NewEvent[]): Promise<void> {
    const batch = this.db.batch()
    batch.set(this.col(ctx.studioId).doc(intent.id), toDoc(intent))
    for (const e of events) {
      batch.set(this.events(ctx.studioId).doc(newEventId()), {
        ...e,
        occurredAt: toTs(e.occurredAt),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }

  async listPendingOlderThan(ctx: TenantContext, olderThanMs: number): Promise<readonly PaymentIntent[]> {
    const snap = await this.col(ctx.studioId)
      .where('status', 'in', ['awaiting_payment', 'processing', 'refund_pending'])
      .get()
    return snap.docs.map((d) => fromDoc(d.id, d.data())).filter((p) => p.createdAt < olderThanMs)
  }

  async listByMember(ctx: TenantContext, memberId: string): Promise<readonly PaymentIntent[]> {
    const snap = await this.col(ctx.studioId).where('memberId', '==', memberId).get()
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
}
