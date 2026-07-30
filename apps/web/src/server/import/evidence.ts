import 'server-only'

import { type EntitlementActivity, type ImportBatch, type MemberActivity, type MemberId, type TenantContext } from '@studio/core'

import { adminDb } from '../firebase-admin'

// WHAT HAPPENED TO A BATCH SINCE IT LANDED.
//
// Gathered here, decided in `decideRevert` — the rule stays pure and testable, this part only reads.
//
// Everything is counted SINCE `appliedAt`. A member who booked a class before the import obviously
// existed before it too, and the import did not create her; but the batch only ever lists members it
// created, so in practice every reservation found here is one made after the import. The date filter
// is belt and braces, and it costs one clause.

export interface RevertEvidence {
  readonly members: readonly MemberActivity[]
  readonly entitlements: readonly EntitlementActivity[]
}

const countWhere = async (path: string, field: string, id: string, since: number): Promise<number> => {
  const snap = await adminDb()
    .collection(path)
    .where(field, '==', id)
    .get()
  // Filtered in memory rather than with a second `where` on a timestamp: a two-field query needs a
  // composite index, and an index that exists locally but not in production is a query that passes
  // every test and fails the one time it runs for real (OR-14). These sets are tiny — one member's
  // reservations — so there is nothing to gain by pushing it into Firestore.
  return snap.docs.filter((d) => {
    const at = d.data().createdAt ?? d.data().bookedAt ?? d.data().occurredAt ?? d.data().receivedAt
    const ms = typeof at?.toMillis === 'function' ? at.toMillis() : Number(at ?? 0)
    return ms === 0 || ms >= since
  }).length
}

export async function collectRevertEvidence(ctx: TenantContext, batch: ImportBatch): Promise<RevertEvidence> {
  const base = `studios/${ctx.studioId}`
  const since = Number(batch.appliedAt)

  const members: MemberActivity[] = []
  for (const memberId of batch.createdMemberIds) {
    const doc = await adminDb().doc(`${base}/members/${memberId}`).get()
    if (!doc.exists) continue // already gone; nothing to block on

    const ownEntitlements = await adminDb().collection(`${base}/entitlements`).where('memberId', '==', memberId).get()
    members.push({
      memberId: memberId as MemberId,
      fullName: String(doc.data()?.fullName ?? memberId),
      reservations: await countWhere(`${base}/reservations`, 'memberId', memberId, since),
      checkIns: await countWhere(`${base}/checkIns`, 'memberId', memberId, since),
      payments: await countWhere(`${base}/payments`, 'memberId', memberId, since),
      // Packages sold to her AFTERWARDS, at the desk. Reverting would deactivate a member who is
      // paying for a package this import knows nothing about.
      otherEntitlements: ownEntitlements.docs.filter((d) => !batch.createdEntitlementIds.includes(d.id)).length,
    })
  }

  const entitlements: EntitlementActivity[] = []
  for (const entitlementId of batch.createdEntitlementIds) {
    const doc = await adminDb().doc(`${base}/entitlements/${entitlementId}`).get()
    if (!doc.exists) continue
    const d = doc.data()!
    const memberDoc = d.memberId ? await adminDb().doc(`${base}/members/${d.memberId}`).get() : null

    // Credits HELD or CONSUMED. A held credit is a booked class that has not happened yet — just as
    // much a reason to refuse as one already spent.
    const c = d.credits
    const used = c ? Number(c.consumed ?? 0) + Number(c.held ?? 0) : 0
    entitlements.push({
      entitlementId,
      memberName: String(memberDoc?.data()?.fullName ?? d.memberId ?? entitlementId),
      creditsUsed: used,
      frozen: d.freeze?.activeFrom != null,
    })
  }

  return { members, entitlements }
}
