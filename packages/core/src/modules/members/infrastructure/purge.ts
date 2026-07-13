import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import type { MemberId, StudioId } from '../../../shared'

// KVKK / GDPR — the PII that leaked OUTWARD, and the one place that cleans it up (v1.27 S5).
//
// ── Why this exists at all ──────────────────────────────────────────────────────────────────
// `eraseMember()` erases the AGGREGATE: the member record is tombstoned and `member.erased` is
// written, in one transaction. But her name and her phone did not stay in `/members`. They were
// copied outward, deliberately, for speed and for delivery:
//
//   • `reservation.memberSnapshot` — so a trainer's roster costs ten reads instead of twenty
//     (DEBT-003, which said in writing that this day would come);
//   • notification intents — her name in the params, her address on the recipient;
//   • her in-app inbox, and her invite tokens.
//
// **Erasure is the one operation that is cross-aggregate by definition**, because the leak was.
//
// ── Why it is ONE implementation, used by two callers ───────────────────────────────────────
// The break-glass script and the owner's screen both erase. Two implementations would be two
// behaviours, and the day they drift is the day one of them forgets her phone number — quietly, in
// a collection nobody thought to check, in a system that told a regulator she was gone.
//
// So: this class, `FirestorePiiPurger`. `tools/kvkk/erase-member.ts` calls it. The Server Action
// calls it. Neither has its own copy.
//
// ── What it does NOT touch ──────────────────────────────────────────────────────────────────
// `/events`. There is nothing there to erase — PII has never entered a payload (#6) — and that rule,
// which cost us convenience for two years, is what lets the ledger keep balancing after she is gone.

export interface PurgePlan {
  readonly reservationSnapshots: number
  readonly notificationIntents: number
  readonly inboxMessages: number
  readonly invites: number
}

const ERASED = '[silindi]'

export class FirestorePiiPurger {
  constructor(private readonly db: Firestore = getFirestore()) {}

  /** What WOULD be purged. The dry run, and the number the owner sees before she agrees. */
  async plan(studioId: StudioId, memberId: MemberId): Promise<PurgePlan> {
    const [reservations, intents, inbox, invites] = await Promise.all([
      this.reservations(studioId, memberId).get(),
      this.intents(studioId, memberId).get(),
      this.db.collection(`studios/${studioId}/members/${memberId}/inbox`).get(),
      this.db.collection(`studios/${studioId}/members/${memberId}/invites`).get(),
    ])
    return {
      reservationSnapshots: reservations.size,
      notificationIntents: intents.size,
      inboxMessages: inbox.size,
      invites: invites.size,
    }
  }

  /** Idempotent: purging an already-purged member is a no-op that writes the same emptiness again. */
  async purge(studioId: StudioId, memberId: MemberId): Promise<PurgePlan> {
    const plan = await this.plan(studioId, memberId)
    const batch = this.db.batch()

    // DEBT-003, come due. The snapshot exists so a roster is cheap; the entry said, in writing, that
    // an erasure would have to purge it. It does.
    for (const doc of (await this.reservations(studioId, memberId).get()).docs) {
      batch.update(doc.ref, {
        'memberSnapshot.displayName': ERASED,
        'memberSnapshot.phoneLast4': null,
      })
    }

    // The intent holds her name (in `params`), her rendered message, and her address. I-38 kept all
    // three OUT of the event log precisely so they could be deleted from here.
    for (const doc of (await this.intents(studioId, memberId).get()).docs) {
      batch.update(doc.ref, {
        params: {},
        'recipient.email': null,
        'recipient.phone': null,
        'recipient.displayName': ERASED,
        erased: true,
      })
    }

    // Her messages and her invite tokens are hers, and they go.
    for (const doc of (
      await this.db.collection(`studios/${studioId}/members/${memberId}/inbox`).get()
    ).docs) {
      batch.delete(doc.ref)
    }
    for (const doc of (
      await this.db.collection(`studios/${studioId}/members/${memberId}/invites`).get()
    ).docs) {
      batch.delete(doc.ref)
    }

    await batch.commit()
    return plan
  }

  private reservations(studioId: StudioId, memberId: MemberId) {
    return this.db.collection(`studios/${studioId}/reservations`).where('memberId', '==', memberId)
  }

  private intents(studioId: StudioId, memberId: MemberId) {
    return this.db
      .collection(`studios/${studioId}/notifications`)
      .where('recipient.id', '==', memberId)
  }
}
