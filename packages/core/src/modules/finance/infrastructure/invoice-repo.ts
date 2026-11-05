import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type ActorRef,
  type DomainError,
  type MemberId,
  type Money,
  type Result,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { InvoiceRepository } from '../application/invoice'
import type { Outcome } from '../domain/decide'
import type { EArchiveRequest, InvoiceMark } from '../domain/invoice'
import { parseInvoicePolicy, type InvoicePolicy } from '../domain/invoice-policy'
import { InvoiceDocuments, type InvoiceDocument } from '../events'

// `studios/{sid}/invoiceMarks/{paymentId}` — the payment id IS the document id, so "is this payment
// invoiced?" is a key lookup and a second tick can never create a second row.
// `studios/{sid}/settings/invoicing` — FT-2 document rules (OR-132). Data, not code.
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

  async listPendingEArchives(ctx: TenantContext): Promise<readonly InvoiceMark[]> {
    const q = await this.col(ctx.studioId).where('eArchive.status', '==', 'pending').limit(25).get()
    return q.docs.map((s) => from(s.id, s.data()))
  }

  async mutateInvoiceMark(
    ctx: TenantContext,
    paymentId: string,
    decide: (current: InvoiceMark | null) => Result<Outcome<InvoiceMark>, DomainError>,
  ): Promise<Result<InvoiceMark, DomainError>> {
    const sid = ctx.studioId
    const ref = this.col(sid).doc(paymentId)
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref)
      const d = s.data()
      const r = decide(s.exists && d ? from(s.id, d) : null)
      if (!r.ok) return r
      const mark = r.value.next
      tx.set(ref, toDoc(mark))
      for (const e of r.value.events) {
        tx.set(this.db.collection('studios').doc(sid).collection('events').doc(newEventId()), {
          ...e,
          occurredAt: Timestamp.fromMillis(e.occurredAt),
          recordedAt: Timestamp.now(),
        })
      }
      return { ok: true as const, value: mark }
    })
  }

  async getInvoicePolicy(ctx: TenantContext): Promise<InvoicePolicy> {
    const s = await this.db.collection('studios').doc(ctx.studioId).collection('settings').doc('invoicing').get()
    return parseInvoicePolicy(s.data())
  }

  async saveInvoicePolicy(ctx: TenantContext, policy: InvoicePolicy): Promise<void> {
    await this.db
      .collection('studios')
      .doc(ctx.studioId)
      .collection('settings')
      .doc('invoicing')
      .set({ ...policy, updatedAt: Timestamp.now(), updatedBy: ctx.actor })
  }
}

function toDoc(mark: InvoiceMark): DocumentData {
  return {
    studioId: mark.studioId,
    memberId: mark.memberId,
    issued: mark.issued,
    issuedAt: mark.issuedAt === null ? null : Timestamp.fromMillis(mark.issuedAt),
    issuedBy: mark.issuedBy,
    note: mark.note,
    invoicedAmount: mark.invoicedAmount,
    document: mark.document,
    provider: mark.provider,
    documentNo: mark.documentNo,
    eArchive: mark.eArchive === null ? null : { ...mark.eArchive, requestedAt: Timestamp.fromMillis(mark.eArchive.requestedAt) },
    emailTo: mark.emailTo,
    updatedAt: Timestamp.now(),
  }
}

function from(id: string, d: DocumentData): InvoiceMark {
  const at = d.issuedAt instanceof Timestamp ? instant(d.issuedAt.toMillis()) : null
  const e = d.eArchive as Record<string, unknown> | null | undefined
  const eArchive: EArchiveRequest | null =
    e && typeof e.requestId === 'string'
      ? {
          requestId: e.requestId,
          status: e.status === 'failed' ? 'failed' : 'pending',
          requestedAt: instant(e.requestedAt instanceof Timestamp ? e.requestedAt.toMillis() : 0),
          requestedBy: e.requestedBy as ActorRef,
          invoicedAmount: e.invoicedAmount as Money,
          attempt: typeof e.attempt === 'number' ? e.attempt : 1,
          error: typeof e.error === 'string' ? e.error : null,
          emailTo: typeof e.emailTo === 'string' ? e.emailTo : null,
        }
      : null
  return {
    paymentId: id,
    studioId: d.studioId as StudioId,
    memberId: d.memberId as MemberId,
    issued: d.issued === true,
    issuedAt: at,
    issuedBy: (d.issuedBy as ActorRef | null) ?? null,
    note: (d.note as string | null) ?? null,
    invoicedAmount: (d.invoicedAmount as Money | null) ?? null,
    // Marks ticked before FT-2 carry no `document`: null reads "elle işaretli", never a guess.
    document: InvoiceDocuments.includes(d.document as InvoiceDocument) ? (d.document as InvoiceDocument) : null,
    provider: d.provider === 'parasut' ? 'parasut' : null,
    documentNo: typeof d.documentNo === 'string' ? d.documentNo : null,
    eArchive,
    emailTo: typeof d.emailTo === 'string' ? d.emailTo : null,
  }
}
