import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { OperationsRepository } from '../application/ports'
import type {
  BulkAction,
  BulkOperation,
  BulkSummary,
  ClosureSummary,
  OperationScope,
  OperationStatus,
  StudioClosure,
} from '../domain/types'

export class FirestoreOperationsRepository implements OperationsRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private closures(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('studioClosures')
  }
  private bulk(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('bulkOperations')
  }
  private events(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('events')
  }
  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.events(sid).doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt),
        recordedAt: Timestamp.now(),
      })
    }
  }

  // ── closures ──
  async getClosure(ctx: TenantContext, id: string): Promise<StudioClosure | null> {
    const s = await this.closures(ctx.studioId).doc(id).get()
    const d = s.data()
    return d ? closureFrom(id, d) : null
  }

  async listClosures(ctx: TenantContext): Promise<readonly StudioClosure[]> {
    const s = await this.closures(ctx.studioId).orderBy('createdAt', 'desc').limit(50).get()
    return s.docs.map((d) => closureFrom(d.id, d.data()))
  }

  async saveClosure(ctx: TenantContext, c: StudioClosure, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      tx.set(this.closures(ctx.studioId).doc(c.id), closureTo(c))
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  async setClosureStatus(ctx: TenantContext, id: string, status: OperationStatus): Promise<void> {
    await this.closures(ctx.studioId).doc(id).update({ status })
  }

  // ── bulk ──
  async getBulk(ctx: TenantContext, id: string): Promise<BulkOperation | null> {
    const s = await this.bulk(ctx.studioId).doc(id).get()
    const d = s.data()
    return d ? bulkFrom(id, d) : null
  }

  async listBulk(ctx: TenantContext): Promise<readonly BulkOperation[]> {
    const s = await this.bulk(ctx.studioId).orderBy('createdAt', 'desc').limit(50).get()
    return s.docs.map((d) => bulkFrom(d.id, d.data()))
  }

  async saveBulk(ctx: TenantContext, b: BulkOperation, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      tx.set(this.bulk(ctx.studioId).doc(b.id), bulkTo(b))
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  async setBulkStatus(ctx: TenantContext, id: string, status: OperationStatus): Promise<void> {
    await this.bulk(ctx.studioId).doc(id).update({ status })
  }
}

function closureTo(c: StudioClosure): DocumentData {
  return {
    studioId: c.studioId,
    dateFrom: c.dateFrom,
    operationId: c.operationId,
    dateTo: c.dateTo,
    reason: c.reason,
    scope: c.scope,
    extensionDays: c.extensionDays,
    calendarDayIds: c.calendarDayIds,
    status: c.status,
    summary: c.summary,
    appliedAt: c.appliedAt ? Timestamp.fromMillis(c.appliedAt) : null,
    createdAt: Timestamp.fromMillis(c.createdAt),
  }
}
function closureFrom(id: string, d: DocumentData): StudioClosure {
  return {
    id,
    // A row written before OP-2 has no operation id; it reads as the closure's own id, which is
    // exactly what its events were correlated by. Nothing to migrate.
    operationId: (d.operationId as StudioClosure['operationId']) ?? (id as StudioClosure['operationId']),
    studioId: d.studioId as StudioId,
    dateFrom: d.dateFrom as StudioClosure['dateFrom'],
    dateTo: d.dateTo as StudioClosure['dateTo'],
    reason: d.reason as string,
    scope: d.scope as OperationScope,
    extensionDays: (d.extensionDays as number) ?? 0,
    calendarDayIds: (d.calendarDayIds as string[]) ?? [],
    status: d.status as OperationStatus,
    summary: (d.summary as ClosureSummary | null) ?? null,
    appliedAt: d.appliedAt ? instant((d.appliedAt as Timestamp).toMillis()) : null,
    createdAt: instant((d.createdAt as Timestamp).toMillis()),
  }
}

function bulkTo(b: BulkOperation): DocumentData {
  return {
    studioId: b.studioId,
    operationId: b.operationId,
    action: b.action,
    scope: b.scope,
    reason: b.reason,
    note: b.note,
    status: b.status,
    summary: b.summary,
    appliedAt: b.appliedAt ? Timestamp.fromMillis(b.appliedAt) : null,
    createdAt: Timestamp.fromMillis(b.createdAt),
  }
}
function bulkFrom(id: string, d: DocumentData): BulkOperation {
  return {
    id,
    operationId: (d.operationId as BulkOperation['operationId']) ?? (id as BulkOperation['operationId']),
    studioId: d.studioId as StudioId,
    action: d.action as BulkAction,
    scope: d.scope as OperationScope,
    reason: d.reason as BulkOperation['reason'],
    note: d.note as string,
    status: d.status as OperationStatus,
    summary: (d.summary as BulkSummary | null) ?? null,
    appliedAt: d.appliedAt ? instant((d.appliedAt as Timestamp).toMillis()) : null,
    createdAt: instant((d.createdAt as Timestamp).toMillis()),
  }
}
