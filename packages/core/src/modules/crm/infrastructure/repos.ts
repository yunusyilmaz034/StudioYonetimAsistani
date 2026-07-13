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
import type { CrmRepository } from '../application/ports'
import type { Interaction, Lead, Offer } from '../domain/types'

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

const leadTo = (l: Lead): DocumentData => ({
  ...l,
  createdAt: ts(l.createdAt),
  closedAt: l.closedAt ? ts(l.closedAt) : null,
})
const leadFrom = (id: string, d: DocumentData): Lead => ({
  ...(d as Lead),
  id,
  createdAt: instant(ms(d.createdAt)),
  closedAt: d.closedAt ? instant(ms(d.closedAt)) : null,
})

const interactionTo = (i: Interaction): DocumentData => ({ ...i, at: ts(i.at) })
const interactionFrom = (id: string, d: DocumentData): Interaction => ({
  ...(d as Interaction),
  id,
  at: instant(ms(d.at)),
})

const offerTo = (o: Offer): DocumentData => ({
  ...o,
  validUntil: ts(o.validUntil),
  createdAt: ts(o.createdAt),
})
const offerFrom = (id: string, d: DocumentData): Offer => ({
  ...(d as Offer),
  id,
  validUntil: instant(ms(d.validUntil)),
  createdAt: instant(ms(d.createdAt)),
})

export class FirestoreCrmRepository implements CrmRepository {
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

  async getLead(ctx: TenantContext, id: string): Promise<Lead | null> {
    const s = await this.col(ctx.studioId, 'leads').doc(id).get()
    const d = s.data()
    return d ? leadFrom(id, d) : null
  }
  async listLeads(ctx: TenantContext): Promise<readonly Lead[]> {
    const snap = await this.col(ctx.studioId, 'leads').get()
    return snap.docs.map((d) => leadFrom(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
  async saveLead(ctx: TenantContext, lead: Lead, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'leads').doc(lead.id), leadTo(lead))
      this.writeEvents(sid, tx, events)
    })
  }

  async listInteractions(
    ctx: TenantContext,
    of: { leadId?: string; memberId?: MemberId },
  ): Promise<readonly Interaction[]> {
    let q = this.col(ctx.studioId, 'interactions').limit(200)
    if (of.leadId) q = q.where('leadId', '==', of.leadId) as CollectionReference
    if (of.memberId) q = q.where('memberId', '==', of.memberId) as CollectionReference
    const snap = await q.get()
    return snap.docs.map((d) => interactionFrom(d.id, d.data())).sort((a, b) => b.at - a.at)
  }
  async saveInteraction(ctx: TenantContext, i: Interaction, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'interactions').doc(i.id), interactionTo(i))
      this.writeEvents(sid, tx, events)
    })
  }

  async getOffer(ctx: TenantContext, id: string): Promise<Offer | null> {
    const s = await this.col(ctx.studioId, 'offers').doc(id).get()
    const d = s.data()
    return d ? offerFrom(id, d) : null
  }
  async listOffers(
    ctx: TenantContext,
    of: { leadId?: string; memberId?: MemberId },
  ): Promise<readonly Offer[]> {
    let q = this.col(ctx.studioId, 'offers').limit(200)
    if (of.leadId) q = q.where('leadId', '==', of.leadId) as CollectionReference
    if (of.memberId) q = q.where('memberId', '==', of.memberId) as CollectionReference
    const snap = await q.get()
    return snap.docs.map((d) => offerFrom(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
  async saveOffer(ctx: TenantContext, offer: Offer, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'offers').doc(offer.id), offerTo(offer))
      this.writeEvents(sid, tx, events)
    })
  }

  async recordChurn(ctx: TenantContext, memberId: MemberId, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      // The churn REASON is a CRM fact; the member document only learns that she left.
      tx.set(
        this.col(sid, 'members').doc(memberId),
        { churnedAt: Timestamp.now() },
        { merge: true },
      )
      this.writeEvents(sid, tx, events)
    })
  }
}
