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
  type ActorRef,
  type BranchId,
  type ClassSessionId,
  type MemberId,
  type NewEvent,
  type ReservationId,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { MemberSnapshot } from '../../members'
import type { WaitlistRepository } from '../application/ports'
import type { WaitlistEntry, WaitlistStatus } from '../domain/types'

function toDoc(e: WaitlistEntry): DocumentData {
  return {
    studioId: e.studioId,
    branchId: e.branchId,
    classSessionId: e.classSessionId,
    memberId: e.memberId,
    memberSnapshot: e.memberSnapshot,
    status: e.status,
    joinedAt: Timestamp.fromMillis(e.joinedAt),
    joinedBy: e.joinedBy,
    resolvedAt: e.resolvedAt ? Timestamp.fromMillis(e.resolvedAt) : null,
    reservationId: e.reservationId,
  }
}

function fromDoc(id: string, d: DocumentData): WaitlistEntry {
  return {
    id,
    studioId: d.studioId as StudioId,
    branchId: d.branchId as BranchId,
    classSessionId: d.classSessionId as ClassSessionId,
    memberId: d.memberId as MemberId,
    memberSnapshot: d.memberSnapshot as MemberSnapshot,
    status: d.status as WaitlistStatus,
    joinedAt: instant((d.joinedAt as Timestamp).toMillis()),
    joinedBy: d.joinedBy as ActorRef,
    resolvedAt: d.resolvedAt ? instant((d.resolvedAt as Timestamp).toMillis()) : null,
    reservationId: (d.reservationId as ReservationId | null) ?? null,
  }
}

export class FirestoreWaitlistRepository implements WaitlistRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('waitlistEntries')
  }
  private events(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('events')
  }
  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.events(sid).doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt),
        recordedAt: Timestamp.now(),
      })
    }
  }

  async getEntry(ctx: TenantContext, id: string): Promise<WaitlistEntry | null> {
    const snap = await this.col(ctx.studioId).doc(id).get()
    const d = snap.data()
    return d ? fromDoc(id, d) : null
  }

  async listBySession(ctx: TenantContext, sessionId: ClassSessionId): Promise<readonly WaitlistEntry[]> {
    const snap = await this.col(ctx.studioId).where('classSessionId', '==', sessionId).get()
    // FIFO in memory: a queue is a handful of rows, and sorting here keeps the tie-break rule in
    // ONE place (byQueueOrder) instead of splitting it between an index and the domain.
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => a.joinedAt - b.joinedAt)
  }

  async listByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly WaitlistEntry[]> {
    const snap = await this.col(ctx.studioId).where('memberId', '==', memberId).get()
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => b.joinedAt - a.joinedAt)
  }

  // The entry and its event commit together (#1). Waiting moves no credit, so nothing else is
  // touched — which is exactly what makes this a one-document write.
  async save(ctx: TenantContext, entry: WaitlistEntry, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid).doc(entry.id), toDoc(entry))
      this.writeEvents(sid, tx, events)
    })
  }
}
