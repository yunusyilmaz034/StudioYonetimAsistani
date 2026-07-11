import { getFirestore, Timestamp, type CollectionReference, type Firestore } from 'firebase-admin/firestore'

import type { BranchId, Instant, MemberId, NewEvent, StudioId, TenantContext } from '../../../shared'
import type { CheckinRepository } from '../application/ports'
import type { BranchOccupancy, CheckIn, Presence } from '../domain/types'
import type { CheckInId } from '../../../shared'
import {
  branchOccupancyFromFirestore,
  branchOccupancyToFirestore,
  checkInFromFirestore,
  checkInToFirestore,
  eventToFirestore,
  presenceFromFirestore,
  presenceToFirestore,
} from './mappers'

export class FirestoreCheckinRepository implements CheckinRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  async getBranch(ctx: TenantContext, branchId: BranchId): Promise<BranchOccupancy | null> {
    const s = await this.col(ctx.studioId, 'branches').doc(branchId).get()
    const d = s.data()
    return d ? branchOccupancyFromFirestore(branchId, d) : null
  }

  async saveBranch(ctx: TenantContext, branch: BranchOccupancy, events: readonly NewEvent[]): Promise<void> {
    const batch = this.db.batch()
    batch.set(this.col(ctx.studioId, 'branches').doc(branch.branchId), branchOccupancyToFirestore(branch), { merge: true })
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      batch.set(this.col(ctx.studioId, 'events').doc(id), data)
    }
    await batch.commit()
  }

  async getPresence(ctx: TenantContext, memberId: MemberId): Promise<Presence | null> {
    const s = await this.col(ctx.studioId, 'presence').doc(memberId).get()
    const d = s.data()
    return d ? presenceFromFirestore(d) : null
  }

  async countPresence(ctx: TenantContext, branchId: BranchId): Promise<number> {
    const snap = await this.col(ctx.studioId, 'presence').where('branchId', '==', branchId).get()
    return snap.size
  }

  async listPresence(ctx: TenantContext, branchId: BranchId): Promise<readonly Presence[]> {
    const snap = await this.col(ctx.studioId, 'presence').where('branchId', '==', branchId).get()
    return snap.docs.map((doc) => presenceFromFirestore(doc.data()))
  }

  async listStalePresence(ctx: TenantContext, checkedInBefore: Instant): Promise<readonly Presence[]> {
    const snap = await this.col(ctx.studioId, 'presence')
      .where('checkedInAt', '<', Timestamp.fromMillis(checkedInBefore))
      .get()
    return snap.docs.map((doc) => presenceFromFirestore(doc.data()))
  }

  async listCheckInsForDay(ctx: TenantContext, branchId: BranchId, since: Instant): Promise<readonly CheckIn[]> {
    const snap = await this.col(ctx.studioId, 'checkIns')
      .where('branchId', '==', branchId)
      .where('occurredAt', '>=', Timestamp.fromMillis(since))
      .get()
    return snap.docs.map((doc) => checkInFromFirestore(doc.id as CheckInId, doc.data()))
  }

  async applyCheckIn(
    ctx: TenantContext,
    memberId: MemberId,
    checkIn: CheckIn,
    presenceNext: Presence | null,
    events: readonly NewEvent[],
  ): Promise<void> {
    const batch = this.db.batch()
    batch.set(this.col(ctx.studioId, 'checkIns').doc(checkIn.id), checkInToFirestore(checkIn))
    const presenceRef = this.col(ctx.studioId, 'presence').doc(memberId)
    if (presenceNext) batch.set(presenceRef, presenceToFirestore(presenceNext))
    else batch.delete(presenceRef)
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      batch.set(this.col(ctx.studioId, 'events').doc(id), data)
    }
    await batch.commit()
  }

  async applyAutoCheckOut(ctx: TenantContext, memberId: MemberId, events: readonly NewEvent[]): Promise<void> {
    const batch = this.db.batch()
    batch.delete(this.col(ctx.studioId, 'presence').doc(memberId))
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      batch.set(this.col(ctx.studioId, 'events').doc(id), data)
    }
    await batch.commit()
  }
}
