import {
  FieldValue,
  getFirestore,
  Timestamp,
  type CollectionReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import {
  err,
  instant,
  ok,
  type ActorType,
  type DomainError,
  type MemberId,
  type NewEvent,
  type Result,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { Member } from '../domain/member'
import type { MemberEventRecord, MemberRepository } from '../application/ports'
import { eventToFirestore, memberFromFirestore, memberToFirestore } from './member-mapper'

// Thrown inside a transaction to abort it with the existing member's id, then
// mapped to a phone_already_registered result outside.
class PhoneTaken {
  constructor(readonly memberId: MemberId) {}
}

export class FirestoreMemberRepository implements MemberRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private members(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('members')
  }
  private byPhone(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('members_by_phone')
  }
  private events(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('events')
  }

  async findById(ctx: TenantContext, id: MemberId): Promise<Member | null> {
    const snap = await this.members(ctx.studioId).doc(id).get()
    const data = snap.data()
    return data ? memberFromFirestore(id, data) : null
  }

  async list(ctx: TenantContext): Promise<readonly Member[]> {
    const snap = await this.members(ctx.studioId).orderBy('fullName').get()
    // decision #2: the Firestore document id maps to MemberId here.
    return snap.docs.map((d) => memberFromFirestore(d.id as MemberId, d.data()))
  }

  async register(
    ctx: TenantContext,
    member: Member,
    events: readonly NewEvent[],
  ): Promise<Result<void, DomainError>> {
    const memberRef = this.members(ctx.studioId).doc(member.id)
    const uniqRef = this.byPhone(ctx.studioId).doc(member.phoneNormalized)
    try {
      await this.db.runTransaction(async (tx) => {
        const uniq = await tx.get(uniqRef) // reads before writes
        if (uniq.exists) throw new PhoneTaken(uniq.data()?.memberId as MemberId)
        tx.set(memberRef, memberToFirestore(member))
        tx.set(uniqRef, { memberId: member.id, createdAt: FieldValue.serverTimestamp() })
        this.writeEvents(ctx.studioId, tx, events)
      })
      return ok(undefined)
    } catch (e) {
      if (e instanceof PhoneTaken) return err({ code: 'phone_already_registered', memberId: e.memberId })
      throw e
    }
  }

  async update(
    ctx: TenantContext,
    member: Member,
    events: readonly NewEvent[],
    previousPhoneNormalized: string,
  ): Promise<Result<void, DomainError>> {
    const phoneChanged = member.phoneNormalized !== previousPhoneNormalized
    const memberRef = this.members(ctx.studioId).doc(member.id)
    const newUniqRef = this.byPhone(ctx.studioId).doc(member.phoneNormalized)
    const oldUniqRef = this.byPhone(ctx.studioId).doc(previousPhoneNormalized)
    try {
      await this.db.runTransaction(async (tx) => {
        if (phoneChanged) {
          const uniq = await tx.get(newUniqRef) // reads before writes
          if (uniq.exists) throw new PhoneTaken(uniq.data()?.memberId as MemberId)
        }
        tx.set(memberRef, memberToFirestore(member))
        if (phoneChanged) {
          tx.set(newUniqRef, { memberId: member.id, createdAt: FieldValue.serverTimestamp() })
          tx.delete(oldUniqRef)
        }
        this.writeEvents(ctx.studioId, tx, events)
      })
      return ok(undefined)
    } catch (e) {
      if (e instanceof PhoneTaken) return err({ code: 'phone_already_registered', memberId: e.memberId })
      throw e
    }
  }

  async deactivate(
    ctx: TenantContext,
    member: Member,
    events: readonly NewEvent[],
  ): Promise<void> {
    const memberRef = this.members(ctx.studioId).doc(member.id)
    await this.db.runTransaction(async (tx) => {
      tx.set(memberRef, memberToFirestore(member))
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  async listMemberEvents(
    ctx: TenantContext,
    id: MemberId,
    limit: number,
  ): Promise<readonly MemberEventRecord[]> {
    const snap = await this.events(ctx.studioId).where('related.memberId', '==', id).get()
    return snap.docs
      .map((doc) => {
        const d = doc.data()
        return {
          type: d.type as string,
          occurredAt: instant((d.occurredAt as Timestamp).toMillis()),
          actorType: (d.actor as { type: ActorType }).type,
          payload: (d.payload as Record<string, unknown>) ?? {},
        }
      })
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, limit)
  }

  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      tx.set(this.events(sid).doc(id), data)
    }
  }
}
