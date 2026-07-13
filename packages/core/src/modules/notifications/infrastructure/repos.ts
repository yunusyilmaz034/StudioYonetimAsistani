import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { InboxRow, NotificationRepository } from '../application/ports'
import type { DeliveryAttempt, NotificationIntent } from '../domain/types'

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

const intentTo = (i: NotificationIntent): DocumentData => ({ ...i, createdAt: ts(i.createdAt) })
const intentFrom = (id: string, d: DocumentData): NotificationIntent => ({
  ...(d as NotificationIntent),
  id,
  createdAt: instant(ms(d.createdAt)),
})

const attemptTo = (a: DeliveryAttempt): DocumentData => ({
  ...a,
  nextRetryAt: a.nextRetryAt ? ts(a.nextRetryAt) : null,
  queuedAt: a.queuedAt ? ts(a.queuedAt) : null,
  sentAt: a.sentAt ? ts(a.sentAt) : null,
  deliveredAt: a.deliveredAt ? ts(a.deliveredAt) : null,
})
const attemptFrom = (id: string, d: DocumentData): DeliveryAttempt => ({
  ...(d as DeliveryAttempt),
  id,
  nextRetryAt: d.nextRetryAt ? instant(ms(d.nextRetryAt)) : null,
  queuedAt: d.queuedAt ? instant(ms(d.queuedAt)) : null,
  sentAt: d.sentAt ? instant(ms(d.sentAt)) : null,
  deliveredAt: d.deliveredAt ? instant(ms(d.deliveredAt)) : null,
})

export class FirestoreNotificationRepository implements NotificationRepository {
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

  async getIntent(ctx: TenantContext, id: string): Promise<NotificationIntent | null> {
    const s = await this.col(ctx.studioId, 'notificationIntents').doc(id).get()
    const d = s.data()
    return d ? intentFrom(id, d) : null
  }

  async listIntents(ctx: TenantContext, limit: number): Promise<readonly NotificationIntent[]> {
    const snap = await this.col(ctx.studioId, 'notificationIntents')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
    return snap.docs.map((d) => intentFrom(d.id, d.data()))
  }

  // The intent and its events commit together (#1). The intent is the DECISION to inform; if the
  // decision is recorded and the event is not, the Activity Center is lying by omission.
  async saveIntent(
    ctx: TenantContext,
    intent: NotificationIntent,
    events: readonly NewEvent[],
  ): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'notificationIntents').doc(intent.id), intentTo(intent))
      this.writeEvents(sid, tx, events)
    })
  }

  async getAttempt(ctx: TenantContext, id: string): Promise<DeliveryAttempt | null> {
    const s = await this.col(ctx.studioId, 'deliveryAttempts').doc(id).get()
    const d = s.data()
    return d ? attemptFrom(id, d) : null
  }

  async listAttempts(ctx: TenantContext, limit: number): Promise<readonly DeliveryAttempt[]> {
    const snap = await this.col(ctx.studioId, 'deliveryAttempts').limit(limit).get()
    return snap.docs
      .map((d) => attemptFrom(d.id, d.data()))
      .sort((a, b) => (b.queuedAt ?? b.sentAt ?? 0) - (a.queuedAt ?? a.sentAt ?? 0))
  }

  async listAttemptsByIntent(ctx: TenantContext, intentId: string): Promise<readonly DeliveryAttempt[]> {
    const snap = await this.col(ctx.studioId, 'deliveryAttempts')
      .where('intentId', '==', intentId)
      .get()
    return snap.docs.map((d) => attemptFrom(d.id, d.data()))
  }

  async listDue(ctx: TenantContext, nowMs: number): Promise<readonly DeliveryAttempt[]> {
    const snap = await this.col(ctx.studioId, 'deliveryAttempts')
      .where('status', '==', 'queued')
      .get()
    return snap.docs
      .map((d) => attemptFrom(d.id, d.data()))
      .filter((a) => a.nextRetryAt === null || a.nextRetryAt <= nowMs)
  }

  async saveAttempt(
    ctx: TenantContext,
    attempt: DeliveryAttempt,
    events: readonly NewEvent[],
  ): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'deliveryAttempts').doc(attempt.id), attemptTo(attempt))
      this.writeEvents(sid, tx, events)
    })
  }

  async countIntentsSince(ctx: TenantContext, sinceMs: number): Promise<number> {
    const snap = await this.col(ctx.studioId, 'notificationIntents')
      .where('createdAt', '>=', ts(sinceMs))
      .count()
      .get()
    return snap.data().count
  }

  // The in-app inbox: a subcollection of the member, so it is erased with her (#6 — her messages
  // carry her name, her class times, her balance).
  async pushInbox(
    ctx: TenantContext,
    memberId: string,
    row: { intentId: string; subject: string; body: string; at: number },
  ): Promise<void> {
    await this.col(ctx.studioId, 'members')
      .doc(memberId)
      .collection('inbox')
      .doc(row.intentId)
      .set({ ...row, at: ts(row.at), read: false })
  }

  async listInbox(ctx: TenantContext, memberId: string): Promise<readonly InboxRow[]> {
    const snap = await this.col(ctx.studioId, 'members')
      .doc(memberId)
      .collection('inbox')
      .orderBy('at', 'desc')
      .limit(50)
      .get()
    return snap.docs.map((d) => ({
      intentId: d.id,
      subject: (d.get('subject') as string) ?? '',
      body: (d.get('body') as string) ?? '',
      at: ms(d.get('at')),
      read: (d.get('read') as boolean) ?? false,
    }))
  }

  async markInboxRead(ctx: TenantContext, memberId: string, intentId: string): Promise<void> {
    await this.col(ctx.studioId, 'members')
      .doc(memberId)
      .collection('inbox')
      .doc(intentId)
      .set({ read: true }, { merge: true })
  }
}
