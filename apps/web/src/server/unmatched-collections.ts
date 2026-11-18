import 'server-only'

import { FirestorePaytrCollectionRepository, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'

/**
 * How many shared-link payments are still waiting to be attributed to a member, and how much money that is.
 * Shown on the Kasa screen (owner, 2026-11-18). A failed read is null, never zero — "nothing waiting" and
 * "could not look" are not the same answer.
 */
export async function loadUnmatchedCollections(ctx: TenantContext): Promise<{ count: number; totalKurus: number } | null> {
  try {
    const cs = await new FirestorePaytrCollectionRepository(adminDb()).listUnreconciled(ctx)
    return { count: cs.length, totalKurus: cs.reduce((n, c) => n + c.amount.amount, 0) }
  } catch (e) {
    console.error('[finance] unreconciled collections unreadable', e)
    return null
  }
}
