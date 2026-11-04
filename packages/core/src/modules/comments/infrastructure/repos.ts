import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore'

import { newEventId, type DomainError, type NewEvent, type Result, type StudioId, type TenantContext } from '../../../shared'
import type { CommentRepository } from '../application'
import type { IgComment } from '../domain/types'

// `studios/{sid}/igComments/{instagram comment id}` — server-only. State + events commit together (#1).
// Instants are stored as epoch-ms numbers.
const fromDoc = (id: string, d: DocumentData): IgComment => ({ ...(d as IgComment), id })

export class FirestoreCommentRepository implements CommentRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name = 'igComments') {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  private writeEvents(tx: Transaction, sid: StudioId, events: readonly NewEvent[]) {
    for (const e of events) tx.set(this.col(sid, 'events').doc(newEventId()), { ...e, occurredAt: Timestamp.fromMillis(e.occurredAt as number), recordedAt: FieldValue.serverTimestamp() })
  }

  async get(ctx: TenantContext, id: string): Promise<IgComment | null> {
    const s = await this.col(ctx.studioId).doc(id).get()
    return s.exists ? fromDoc(s.id, s.data()!) : null
  }

  async existingIds(ctx: TenantContext, ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set()
    const snaps = await this.db.getAll(...ids.map((id) => this.col(ctx.studioId).doc(id)), { fieldMask: ['status'] })
    return new Set(snaps.filter((s) => s.exists).map((s) => s.id))
  }

  async listByStatus(ctx: TenantContext, status: IgComment['status'], limit: number): Promise<readonly IgComment[]> {
    const snap = await this.col(ctx.studioId).where('status', '==', status).limit(limit).get()
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => (b.commentedAt as number) - (a.commentedAt as number))
  }

  async listRecent(ctx: TenantContext, limit: number): Promise<readonly IgComment[]> {
    const snap = await this.col(ctx.studioId).orderBy('commentedAt', 'desc').limit(limit).get()
    return snap.docs.map((d) => fromDoc(d.id, d.data()))
  }

  async createIfAbsent(ctx: TenantContext, c: IgComment, events: readonly NewEvent[]): Promise<boolean> {
    const ref = this.col(ctx.studioId).doc(c.id)
    return this.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false
      tx.set(ref, c)
      this.writeEvents(tx, ctx.studioId, events)
      return true
    })
  }

  async mutate(
    ctx: TenantContext,
    id: string,
    decide: (c: IgComment) => Result<{ next: IgComment; events: readonly NewEvent[] }, DomainError>,
  ): Promise<Result<IgComment, DomainError>> {
    const ref = this.col(ctx.studioId).doc(id)
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref)
      if (!s.exists) return { ok: false as const, error: { code: 'operation_not_applicable' as const } }
      const r = decide(fromDoc(s.id, s.data()!))
      if (!r.ok) return r
      tx.set(ref, r.value.next)
      this.writeEvents(tx, ctx.studioId, r.value.events)
      return { ok: true as const, value: r.value.next }
    })
  }

  /** A refused send changes nothing that happened — only the note on the card. */
  async saveFailure(ctx: TenantContext, c: IgComment): Promise<void> {
    await this.col(ctx.studioId).doc(c.id).set({ lastFailure: c.lastFailure }, { merge: true })
  }
}
