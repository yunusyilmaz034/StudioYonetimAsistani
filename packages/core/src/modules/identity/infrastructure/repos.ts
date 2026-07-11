import { getFirestore, type CollectionReference, type Firestore } from 'firebase-admin/firestore'

import type { StaffUserId, StudioId, TenantContext } from '../../../shared'
import type { IdentityRepository } from '../application/ports'
import type { StaffMember } from '../domain/types'
import { staffFromFirestore } from './mappers'

export class FirestoreIdentityRepository implements IdentityRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  async listStaff(ctx: TenantContext): Promise<readonly StaffMember[]> {
    const snap = await this.col(ctx.studioId, 'staff').get()
    return snap.docs.map((doc) => staffFromFirestore(doc.id as StaffUserId, doc.data()))
  }
}
