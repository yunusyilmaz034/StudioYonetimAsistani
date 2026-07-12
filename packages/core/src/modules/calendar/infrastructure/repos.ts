import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type BranchId,
  type LocalDate,
  type NewEvent,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { CalendarRepository } from '../application/ports'
import type { CalendarDayType, StudioCalendarDay } from '../domain/types'

function toDoc(d: StudioCalendarDay): DocumentData {
  return {
    studioId: d.studioId,
    dateFrom: d.dateFrom,
    dateTo: d.dateTo,
    timeFrom: d.timeFrom,
    timeTo: d.timeTo,
    type: d.type,
    title: d.title,
    note: d.note,
    branchIds: d.branchIds,
    source: d.source,
    providerRef: d.providerRef
      ? {
          provider: d.providerRef.provider,
          externalId: d.providerRef.externalId,
          importedAt: Timestamp.fromMillis(d.providerRef.importedAt),
        }
      : null,
    createdAt: Timestamp.fromMillis(d.createdAt),
  }
}

function fromDoc(id: string, d: DocumentData): StudioCalendarDay {
  const p = d.providerRef as { provider: string; externalId: string; importedAt: Timestamp } | null
  return {
    id,
    studioId: d.studioId as StudioId,
    dateFrom: d.dateFrom as LocalDate,
    dateTo: d.dateTo as LocalDate,
    timeFrom: (d.timeFrom as string | null) ?? null,
    timeTo: (d.timeTo as string | null) ?? null,
    type: d.type as CalendarDayType,
    title: d.title as string,
    note: (d.note as string | null) ?? null,
    branchIds: (d.branchIds as BranchId[] | null) ?? null,
    source: (d.source as 'manual' | 'provider') ?? 'manual',
    providerRef: p
      ? { provider: p.provider, externalId: p.externalId, importedAt: instant(p.importedAt.toMillis()) }
      : null,
    createdAt: instant((d.createdAt as Timestamp).toMillis()),
  }
}

export class FirestoreCalendarRepository implements CalendarRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('studioCalendar')
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

  // A range read: any day that OVERLAPS [from, to]. Firestore cannot express an overlap in one
  // query, so we bound on `dateFrom <= to` and filter the tail in memory — the calendar is a few
  // dozen rows a year, so this is cheaper than a second index.
  async listDays(ctx: TenantContext, from: LocalDate, to: LocalDate): Promise<readonly StudioCalendarDay[]> {
    const snap = await this.col(ctx.studioId).where('dateFrom', '<=', to).get()
    return snap.docs
      .map((d) => fromDoc(d.id, d.data()))
      .filter((d) => d.dateTo >= from)
      .sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0))
  }

  async getDay(ctx: TenantContext, id: string): Promise<StudioCalendarDay | null> {
    const snap = await this.col(ctx.studioId).doc(id).get()
    const d = snap.data()
    return d ? fromDoc(id, d) : null
  }

  async findByProviderRef(
    ctx: TenantContext,
    provider: string,
    externalId: string,
  ): Promise<StudioCalendarDay | null> {
    const snap = await this.col(ctx.studioId)
      .where('providerRef.provider', '==', provider)
      .where('providerRef.externalId', '==', externalId)
      .limit(1)
      .get()
    const doc = snap.docs[0]
    return doc ? fromDoc(doc.id, doc.data()) : null
  }

  async saveDay(ctx: TenantContext, day: StudioCalendarDay, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(ctx.studioId).doc(day.id), toDoc(day))
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  async removeDay(ctx: TenantContext, id: string, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      tx.delete(this.col(ctx.studioId).doc(id))
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  // Batched, not one transaction: a calendar row is not a credit. An interrupted import is
  // re-runnable (upsert by providerRef) rather than dangerous.
  async saveImported(
    ctx: TenantContext,
    days: readonly StudioCalendarDay[],
    events: readonly NewEvent[],
  ): Promise<void> {
    const batch = this.db.batch()
    for (const d of days) batch.set(this.col(ctx.studioId).doc(d.id), toDoc(d))
    for (const e of events) {
      batch.set(this.events(ctx.studioId).doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt),
        recordedAt: Timestamp.now(),
      })
    }
    await batch.commit()
  }
}
