import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'

import { instant, newEventId, type ActorRef, type MemberId, type Money, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { InvoiceRepository } from '../application/invoice'
import type { InvoiceMark } from '../domain/invoice'

// `studios/{sid}/invoiceMarks/{paymentId}` — the payment id IS the document id, so "is this payment
// invoiced?" is a key lookup and a second tick can never create a second row.
export class FirestoreInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId) {
    return this.db.collection('studios').doc(sid).collection('invoiceMarks')
  }

  async getInvoiceMark(ctx: TenantContext, paymentId: string): Promise<InvoiceMark | null> {
    const s = await this.col(ctx.studioId).doc(paymentId).get()
    const d = s.data()
    return s.exists && d ? from(s.id, d) : null
  }

  async listInvoiceMarks(ctx: TenantContext, paymentIds: readonly string[]): Promise<readonly InvoiceMark[]> {
    if (paymentIds.length === 0) return []
    const snaps = await this.db.getAll(...paymentIds.map((id) => this.col(ctx.studioId).doc(id)))
    return snaps.flatMap((s) => {
      const d = s.data()
      return s.exists && d ? [from(s.id, d)] : []
    })
  }

  async saveInvoiceMark(ctx: TenantContext, mark: InvoiceMark, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid).doc(mark.paymentId), {
        studioId: mark.studioId,
        memberId: mark.memberId,
        issued: mark.issued,
        issuedAt: mark.issuedAt === null ? null : Timestamp.fromMillis(mark.issuedAt),
        issuedBy: mark.issuedBy,
        note: mark.note,
        invoicedAmount: mark.invoicedAmount,
        updatedAt: Timestamp.now(),
      })
      for (const e of events) {
        tx.set(this.db.collection('studios').doc(sid).collection('events').doc(newEventId()), {
          ...e,
          occurredAt: Timestamp.fromMillis(e.occurredAt),
          recordedAt: Timestamp.now(),
        })
      }
    })
  }
}

function from(id: string, d: DocumentData): InvoiceMark {
  const at = d.issuedAt instanceof Timestamp ? instant(d.issuedAt.toMillis()) : null
  return {
    paymentId: id,
    studioId: d.studioId as StudioId,
    memberId: d.memberId as MemberId,
    issued: d.issued === true,
    issuedAt: at,
    issuedBy: (d.issuedBy as ActorRef | null) ?? null,
    note: (d.note as string | null) ?? null,
    invoicedAmount: (d.invoicedAmount as Money | null) ?? null,
  }
}
