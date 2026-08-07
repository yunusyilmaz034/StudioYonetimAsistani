import { getFirestore, Timestamp, type CollectionReference, type Firestore } from 'firebase-admin/firestore'

import { instant, type BranchId, type DeviceId, type Instant, type MemberId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { CheckinRepository } from '../application/ports'
import type { BranchOccupancy, CheckIn, Presence, TurnstileCode, TurnstileDevice } from '../domain/types'
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

  // ── Turnstile (v1.33) ──
  async getDevice(ctx: TenantContext, deviceId: DeviceId): Promise<TurnstileDevice | null> {
    const s = await this.col(ctx.studioId, 'devices').doc(deviceId).get()
    const d = s.data()
    return d ? ({ ...(d as TurnstileDevice), id: deviceId, lastSeenAt: d.lastSeenAt ? instant(d.lastSeenAt.toMillis()) : null, createdAt: instant(d.createdAt.toMillis()) }) : null
  }

  async listDevices(ctx: TenantContext): Promise<readonly TurnstileDevice[]> {
    const snap = await this.col(ctx.studioId, 'devices').get()
    return snap.docs.map((doc) => {
      const d = doc.data()
      return { ...(d as TurnstileDevice), id: doc.id as DeviceId, lastSeenAt: d.lastSeenAt ? instant(d.lastSeenAt.toMillis()) : null, createdAt: instant(d.createdAt.toMillis()) }
    })
  }

  async saveDevice(ctx: TenantContext, device: TurnstileDevice): Promise<void> {
    await this.col(ctx.studioId, 'devices').doc(device.id).set(
      {
        ...device,
        lastSeenAt: device.lastSeenAt === null ? null : Timestamp.fromMillis(device.lastSeenAt),
        createdAt: Timestamp.fromMillis(device.createdAt),
      },
      { merge: true },
    )
  }

  async saveDeviceWithEvents(ctx: TenantContext, device: TurnstileDevice, events: readonly NewEvent[]): Promise<void> {
    const batch = this.db.batch()
    batch.set(
      this.col(ctx.studioId, 'devices').doc(device.id),
      {
        ...device,
        lastSeenAt: device.lastSeenAt === null ? null : Timestamp.fromMillis(device.lastSeenAt),
        createdAt: Timestamp.fromMillis(device.createdAt),
      },
      { merge: true },
    )
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      batch.set(this.col(ctx.studioId, 'events').doc(id), data)
    }
    await batch.commit()
  }

  async getTurnstileCode(ctx: TenantContext, code: string): Promise<TurnstileCode | null> {
    const s = await this.col(ctx.studioId, 'turnstileCodes').doc(code).get()
    const d = s.data()
    if (!d) return null
    return {
      ...(d as TurnstileCode),
      issuedAt: instant(d.issuedAt.toMillis()),
      expiresAt: instant(d.expiresAt.toMillis()),
      usedAt: d.usedAt ? instant(d.usedAt.toMillis()) : null,
    }
  }

  async saveTurnstileCode(ctx: TenantContext, code: TurnstileCode): Promise<void> {
    await this.col(ctx.studioId, 'turnstileCodes').doc(code.code).set({
      ...code,
      issuedAt: Timestamp.fromMillis(code.issuedAt),
      expiresAt: Timestamp.fromMillis(code.expiresAt),
      usedAt: code.usedAt === null ? null : Timestamp.fromMillis(code.usedAt),
    })
  }

  /**
   * Spend the code, atomically.
   *
   * A TRANSACTION rather than a read-then-write, because single use IS the race: two phones pointed
   * at the same screen in the same second must produce one winner. Read-then-write would let both
   * see `usedBy: null` and both open the door — the one failure mode this feature cannot have.
   */
  async consumeTurnstileCode(ctx: TenantContext, code: string, memberId: MemberId, at: Instant): Promise<boolean> {
    const ref = this.col(ctx.studioId, 'turnstileCodes').doc(code)
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const d = snap.data()
      if (!d || d.usedBy) return false
      tx.update(ref, { usedBy: memberId, usedAt: Timestamp.fromMillis(at) })
      return true
    })
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

  // Member Workspace (v1.18): one member's check-in history since a bound, newest first.
  // Served by the `checkIns (memberId, occurredAt)` composite index.
  async listCheckInsByMember(ctx: TenantContext, memberId: MemberId, since: Instant): Promise<readonly CheckIn[]> {
    const snap = await this.col(ctx.studioId, 'checkIns')
      .where('memberId', '==', memberId)
      .where('occurredAt', '>=', Timestamp.fromMillis(since))
      .orderBy('occurredAt', 'desc')
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
