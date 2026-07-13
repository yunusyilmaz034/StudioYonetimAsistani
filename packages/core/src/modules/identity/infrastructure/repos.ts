import {
  FieldValue,
  getFirestore,
  Timestamp,
  type CollectionReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import { newEventId, type NewEvent, type StaffUserId, type StudioId, type TenantContext } from '../../../shared'
import type { IdentityRepository } from '../application/ports'
import type { StaffMember } from '../domain/types'
import { staffFromFirestore, staffToFirestore } from './mappers'

export class FirestoreIdentityRepository implements IdentityRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  async listStaff(ctx: TenantContext): Promise<readonly StaffMember[]> {
    const snap = await this.col(ctx.studioId, 'staff').get()
    return snap.docs.map((doc) => staffFromFirestore(doc.id as StaffUserId, doc.data()))
  }

  async getStaff(ctx: TenantContext, id: StaffUserId): Promise<StaffMember | null> {
    const snap = await this.col(ctx.studioId, 'staff').doc(id).get()
    return snap.exists ? staffFromFirestore(id, snap.data() ?? {}) : null
  }

  /** The document and its event(s), in ONE transaction (#1). A role that changed without an event
   *  is a role nobody can explain — and explaining it is the only reason these are events. */
  async saveStaff(
    ctx: TenantContext,
    staff: StaffMember,
    events: readonly NewEvent[],
  ): Promise<void> {
    const ref = this.col(ctx.studioId, 'staff').doc(staff.id)
    await this.db.runTransaction(async (tx: Transaction) => {
      tx.set(ref, staffToFirestore(staff), { merge: true })
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  // Two timestamps, never one (#3): `occurredAt` is domain time, `recordedAt` is the server's.
  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.col(sid, 'events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
  }
}
