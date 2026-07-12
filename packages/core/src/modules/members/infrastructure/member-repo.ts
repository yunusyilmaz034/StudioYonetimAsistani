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
  type Instant,
  type MemberId,
  type NewEvent,
  type Result,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { Member } from '../domain/member'
import type { MemberInvite } from '../domain/invite'
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
  // Keyed by the token HASH — the raw token lives only in the link we hand to the member.
  private invites(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('invites')
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

  // ── The portal invite (v1.21) ──

  async issueInvite(ctx: TenantContext, invite: MemberInvite, events: readonly NewEvent[]): Promise<void> {
    // Supersede every still-pending invite for this member IN THE SAME transaction as the new
    // one. Otherwise a "resend" would leave two live links to the same account, and revoking
    // access (D17 — the password-reset path) would be impossible to reason about.
    const stale = await this.invites(ctx.studioId)
      .where('memberId', '==', invite.memberId)
      .where('status', '==', 'pending')
      .get()

    await this.db.runTransaction(async (tx) => {
      for (const d of stale.docs) tx.update(d.ref, { status: 'superseded' })
      tx.set(this.invites(ctx.studioId).doc(invite.tokenHash), {
        memberId: invite.memberId,
        status: invite.status,
        issuedAt: Timestamp.fromMillis(invite.issuedAt),
        expiresAt: Timestamp.fromMillis(invite.expiresAt),
        consumedAt: null,
      })
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  async findInviteByHash(ctx: TenantContext, tokenHash: string): Promise<MemberInvite | null> {
    const snap = await this.invites(ctx.studioId).doc(tokenHash).get()
    const d = snap.data()
    if (!d) return null
    return {
      tokenHash,
      studioId: ctx.studioId,
      memberId: d.memberId as MemberId,
      status: d.status as MemberInvite['status'],
      issuedAt: instant((d.issuedAt as Timestamp).toMillis()),
      expiresAt: instant((d.expiresAt as Timestamp).toMillis()),
      consumedAt: d.consumedAt ? instant((d.consumedAt as Timestamp).toMillis()) : null,
    }
  }

  async consumeInvite(
    ctx: TenantContext,
    invite: MemberInvite,
    consumedAt: Instant,
    events: readonly NewEvent[],
  ): Promise<void> {
    const ref = this.invites(ctx.studioId).doc(invite.tokenHash)
    await this.db.runTransaction(async (tx) => {
      // Re-read INSIDE the transaction: two people opening the same link at the same moment
      // must not both activate. The loser sees a consumed invite.
      const snap = await tx.get(ref)
      const d = snap.data()
      if (!d || d.status !== 'pending') throw new Error('invite_invalid')
      tx.update(ref, { status: 'consumed', consumedAt: Timestamp.fromMillis(consumedAt) })
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  async appendEvents(ctx: TenantContext, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx) => {
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
