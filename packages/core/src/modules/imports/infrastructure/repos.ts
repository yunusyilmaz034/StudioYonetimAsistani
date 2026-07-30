import { FieldValue, type Firestore } from 'firebase-admin/firestore'

import type { MemberId, StudioId, TenantContext } from '../../../shared'
import type { ImportBatchRepository } from '../application/ports'
import type { ImportBatch, ImportBatchStatus, ImportKind } from '../domain/types'

// The batch store. Server-only by rule (`importBatches` is in the serverOnly list): a client that
// could read it could enumerate the roster by id, and one that could write it could point a
// reversal at records no import ever made.

interface Stored {
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

function fromStored(id: string, d: Stored): ImportBatch {
  return {
    id,
    kind: d.kind,
    fileName: d.fileName,
    rowCount: d.rowCount ?? 0,
    createdMemberIds: (d.createdMemberIds ?? []) as MemberId[],
    createdEntitlementIds: d.createdEntitlementIds ?? [],
    skipped: d.skipped ?? 0,
    status: d.status,
    appliedAt: d.appliedAt as ImportBatch['appliedAt'],
    revertedAt: (d.revertedAt ?? null) as ImportBatch['revertedAt'],
    appliedBy: d.appliedBy ?? '—',
    revertReason: d.revertReason ?? null,
  }
}

export class FirestoreImportBatchRepository implements ImportBatchRepository {
  constructor(private readonly db: Firestore) {}

  private col(studioId: StudioId) {
    return this.db.collection(`studios/${studioId}/importBatches`)
  }

  async open(ctx: TenantContext, batch: ImportBatch, appliedBy: string): Promise<void> {
    const doc: Stored = {
      kind: batch.kind,
      fileName: batch.fileName,
      rowCount: batch.rowCount,
      createdMemberIds: [],
      createdEntitlementIds: [],
      skipped: 0,
      status: 'applied',
      appliedAt: Number(batch.appliedAt),
      revertedAt: null,
      appliedBy,
      revertReason: null,
    }
    await this.col(ctx.studioId).doc(batch.id).set(doc)
  }

  async recordCreated(
    ctx: TenantContext,
    batchId: string,
    created: { memberId?: MemberId; entitlementId?: string },
  ): Promise<void> {
    const patch: Record<string, unknown> = {}
    if (created.memberId) patch.createdMemberIds = FieldValue.arrayUnion(created.memberId)
    if (created.entitlementId) patch.createdEntitlementIds = FieldValue.arrayUnion(created.entitlementId)
    if (Object.keys(patch).length === 0) return
    await this.col(ctx.studioId).doc(batchId).set(patch, { merge: true })
  }

  async close(ctx: TenantContext, batchId: string, skipped: number): Promise<void> {
    // Only the count. The id arrays are NOT rewritten — they were appended one at a time, and
    // overwriting them from an in-memory copy would discard anything a concurrent retry recorded.
    await this.col(ctx.studioId).doc(batchId).set({ skipped }, { merge: true })
  }

  async get(ctx: TenantContext, batchId: string): Promise<ImportBatch | null> {
    const snap = await this.col(ctx.studioId).doc(batchId).get()
    return snap.exists ? fromStored(snap.id, snap.data() as Stored) : null
  }

  async markReverted(ctx: TenantContext, batchId: string, at: number, reason: string): Promise<void> {
    await this.col(ctx.studioId)
      .doc(batchId)
      .set({ status: 'reverted', revertedAt: at, revertReason: reason }, { merge: true })
  }

  async list(ctx: TenantContext, limit: number): Promise<readonly ImportBatch[]> {
    // Ordered by the field the screen shows, in the direction it shows it — an index built for the
    // other direction is a query that passes locally and fails in production (OR-14).
    const snap = await this.col(ctx.studioId).orderBy('appliedAt', 'desc').limit(limit).get()
    return snap.docs.map((d) => fromStored(d.id, d.data() as Stored))
  }
}
