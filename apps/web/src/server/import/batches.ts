import 'server-only'

import type { ImportBatch, ImportBatchStatus, ImportKind } from '@studio/core'
import type { MemberId, TenantContext } from '@studio/core'

import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from '../firebase-admin'

// The batch record: what an import created, so a reversal knows exactly what to undo.
//
// Reconstructing this from the log by timestamp would sweep up whatever else happened in the same
// second — a member registered at reception while the import ran is not part of the import.
//
// Server-only. It lives behind the Admin SDK and no client rule grants access to it; it is not read
// by a member and not written by anything but the wizard.

const col = (studioId: string) => adminDb().collection(`studios/${studioId}/importBatches`)

interface StoredBatch {
  kind: ImportKind
  fileName: string
  rowCount: number
  createdMemberIds: string[]
  createdEntitlementIds: string[]
  skipped: number
  status: ImportBatchStatus
  appliedAt: number
  revertedAt: number | null
  appliedBy: string
  revertReason: string | null
}

function fromStored(id: string, d: StoredBatch): ImportBatch {
  return {
    id,
    kind: d.kind,
    fileName: d.fileName,
    rowCount: d.rowCount,
    createdMemberIds: (d.createdMemberIds ?? []) as MemberId[],
    createdEntitlementIds: d.createdEntitlementIds ?? [],
    skipped: d.skipped ?? 0,
    status: d.status,
    appliedAt: d.appliedAt as ImportBatch['appliedAt'],
    revertedAt: (d.revertedAt ?? null) as ImportBatch['revertedAt'],
  }
}

export interface BatchRow extends ImportBatch {
  readonly appliedBy: string
  readonly revertReason: string | null
}

/** Open the batch BEFORE anything is created, so the first row already has somewhere to be recorded. */
export async function openBatch(
  ctx: TenantContext,
  batchId: string,
  kind: ImportKind,
  fileName: string,
  rowCount: number,
  appliedAt: number,
  appliedBy: string,
): Promise<void> {
  const doc: StoredBatch = {
    kind, fileName, rowCount,
    createdMemberIds: [], createdEntitlementIds: [],
    skipped: 0, status: 'applied', appliedAt, revertedAt: null, appliedBy, revertReason: null,
  }
  await col(ctx.studioId).doc(batchId).set(doc)
}

/** Close it: the counts the screen reports, once the loop is done. */
export async function closeBatch(ctx: TenantContext, batchId: string, skipped: number): Promise<void> {
  // Only the count. The id arrays are NOT rewritten here — they were appended row by row, and
  // overwriting them with an in-memory copy would discard anything a concurrent retry recorded.
  await col(ctx.studioId).doc(batchId).set({ skipped }, { merge: true })
}

/**
 * Append one created id to a batch that is still being applied.
 *
 * Called per record, not once at the end. A crash in row forty would otherwise leave thirty-nine
 * members in the studio with no record that they came from an import — orphans nobody can find, let
 * alone undo. `arrayUnion` is idempotent, so a retried row cannot double-count.
 */
export async function recordCreated(
  ctx: TenantContext,
  batchId: string,
  created: { memberId?: MemberId; entitlementId?: string },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (created.memberId) patch.createdMemberIds = FieldValue.arrayUnion(created.memberId)
  if (created.entitlementId) patch.createdEntitlementIds = FieldValue.arrayUnion(created.entitlementId)
  if (Object.keys(patch).length === 0) return
  await col(ctx.studioId).doc(batchId).set(patch, { merge: true })
}

export async function getBatch(ctx: TenantContext, batchId: string): Promise<ImportBatch | null> {
  const snap = await col(ctx.studioId).doc(batchId).get()
  return snap.exists ? fromStored(snap.id, snap.data() as StoredBatch) : null
}

export async function markReverted(
  ctx: TenantContext,
  batchId: string,
  at: number,
  reason: string,
): Promise<void> {
  await col(ctx.studioId).doc(batchId).set({ status: 'reverted', revertedAt: at, revertReason: reason }, { merge: true })
}

export async function listBatches(ctx: TenantContext, limit = 25): Promise<readonly BatchRow[]> {
  // Ordered by the field the screen shows, and the direction it shows it in — an index built for a
  // different direction is a query that passes locally and fails in production (OR-14).
  const snap = await col(ctx.studioId).orderBy('appliedAt', 'desc').limit(limit).get()
  return snap.docs.map((d) => {
    const data = d.data() as StoredBatch
    return { ...fromStored(d.id, data), appliedBy: data.appliedBy ?? '—', revertReason: data.revertReason ?? null }
  })
}
