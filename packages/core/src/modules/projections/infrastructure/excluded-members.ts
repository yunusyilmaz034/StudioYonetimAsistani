import type { Firestore } from 'firebase-admin/firestore'

import type { StudioId } from '../../../shared'

// WHICH ACCOUNTS THE READ MODEL IGNORES (owner, 2026-07-29).
//
// The studio's own people tried the system out on live accounts. Their sales, payments, reversals
// and attendance are real events and stay in the log for ever; they simply stop being COUNTED.
//
// This lives in Firestore rather than in source for two reasons. Member ids belong to one tenant
// and have no place in shared code. And the live projector and `pnpm projections:rebuild` must
// reach the same answer — one list, one document, read by both. `pnpm projections:verify` recomputes
// the log and diffs it against the stored model, so a drift between the two shows up as a failure
// rather than as a number nobody can explain.
//
// Absent document ⇒ empty set ⇒ everything counts. A studio that never needed this pays nothing,
// and a read failure must never silently start hiding revenue.
export async function loadExcludedMemberIds(db: Firestore, studioId: StudioId): Promise<ReadonlySet<string>> {
  const snap = await db.doc(`studios/${studioId}/settings/projection`).get()
  const raw = snap.exists ? (snap.data()?.excludedMemberIds as unknown) : null
  return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.length > 0) : [])
}
