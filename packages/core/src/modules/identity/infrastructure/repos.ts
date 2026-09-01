import {
  FieldValue,
  getFirestore,
  Timestamp,
  type CollectionReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StaffUserId, type StudioId, type TenantContext } from '../../../shared'
import type { IdentityRepository, StaffShiftRepository } from '../application/ports'
import type { StaffMember, StaffShift } from '../domain/types'
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

// ── MESAİ (owner, 2026-09-01) ───────────────────────────────────────────────────────────────
//
// `staffShifts`: bir vardiya bir belge. "Bugünün vardiyası" diye bir belge YOK — gece yarısını
// geçen bir mesai hâlâ tek bir vardiyadır, ve günlük belge onu ikiye bölerdi.
export class FirestoreStaffShiftRepository implements StaffShiftRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('staffShifts')
  }

  async getOpenShift(ctx: TenantContext, staffUserId: StaffUserId): Promise<StaffShift | null> {
    // Açık vardiya kişi başına EN FAZLA bir tane (karar öyle diyor). `limit(1)` bunu varsaymıyor,
    // yalnızca okumayı ucuz tutuyor — birden fazlası olsaydı en yenisi kazanırdı ve o da bir
    // ipucu olurdu, sessiz bir bozulma değil.
    const snap = await this.col(ctx.studioId)
      .where('staffUserId', '==', staffUserId)
      .where('endedAt', '==', null)
      .limit(1)
      .get()
    const d = snap.docs[0]
    return d ? this.oku(d.id, d.data()) : null
  }

  async listShifts(ctx: TenantContext, fromAt: number, toAt: number): Promise<readonly StaffShift[]> {
    const snap = await this.col(ctx.studioId)
      .where('startedAt', '>=', Timestamp.fromMillis(fromAt))
      .where('startedAt', '<=', Timestamp.fromMillis(toAt))
      .orderBy('startedAt', 'desc')
      .get()
    return snap.docs.map((d) => this.oku(d.id, d.data()))
  }

  async saveShift(ctx: TenantContext, shift: StaffShift, events: readonly NewEvent[]): Promise<void> {
    const ref = this.col(ctx.studioId).doc(shift.id)
    await this.db.runTransaction(async (tx: Transaction) => {
      tx.set(
        ref,
        {
          staffUserId: shift.staffUserId,
          branchId: shift.branchId,
          startedAt: Timestamp.fromMillis(shift.startedAt as number),
          endedAt: shift.endedAt === null ? null : Timestamp.fromMillis(shift.endedAt as number),
        },
        { merge: true },
      )
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  private oku(id: string, d: Record<string, unknown>): StaffShift {
    const ts = (v: unknown): number => (v as Timestamp).toMillis()
    return {
      id,
      staffUserId: d.staffUserId as StaffUserId,
      branchId: (d.branchId ?? null) as StaffShift['branchId'],
      startedAt: instant(ts(d.startedAt)),
      endedAt: d.endedAt == null ? null : instant(ts(d.endedAt)),
    }
  }

  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.db.collection('studios').doc(sid).collection('events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
  }
}
