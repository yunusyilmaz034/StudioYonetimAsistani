import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type Firestore,
  type WriteBatch,
} from 'firebase-admin/firestore'

import type { EntitlementId, Instant, MemberId, NewEvent, StudioId, TenantContext } from '../../../shared'
import type { EntitlementRepository } from '../application/ports'
import type { Entitlement } from '../domain/types'
import { entitlementFromFirestore, entitlementToFirestore, eventToFirestore } from './mappers'

export class FirestoreEntitlementRepository implements EntitlementRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  private appendEvents(sid: StudioId, batch: WriteBatch, events: readonly NewEvent[]): void {
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      batch.set(this.col(sid, 'events').doc(id), data)
    }
  }

  async getEntitlement(ctx: TenantContext, id: EntitlementId): Promise<Entitlement | null> {
    const s = await this.col(ctx.studioId, 'entitlements').doc(id).get()
    const d = s.data()
    return d ? entitlementFromFirestore(id, d) : null
  }

  async listActiveByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Entitlement[]> {
    const snap = await this.col(ctx.studioId, 'entitlements')
      .where('memberId', '==', memberId)
      .where('status', '==', 'active')
      .get()
    return snap.docs.map((doc) => entitlementFromFirestore(doc.id as EntitlementId, doc.data()))
  }

  async listExpirable(
    ctx: TenantContext,
    validUntilAtOrBefore: Instant,
  ): Promise<readonly EntitlementId[]> {
    const snap = await this.col(ctx.studioId, 'entitlements')
      .where('status', '==', 'active')
      .where('validUntil', '<=', Timestamp.fromMillis(validUntilAtOrBefore))
      .get()
    return snap.docs.map((doc) => doc.id as EntitlementId)
  }

  async saveEntitlement(
    ctx: TenantContext,
    entitlement: Entitlement,
    events: readonly NewEvent[],
  ): Promise<void> {
    const batch = this.db.batch()
    batch.set(this.col(ctx.studioId, 'entitlements').doc(entitlement.id), entitlementToFirestore(entitlement))
    this.appendEvents(ctx.studioId, batch, events)
    await batch.commit()
  }
}
