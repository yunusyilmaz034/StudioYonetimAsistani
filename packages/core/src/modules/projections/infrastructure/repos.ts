import {
  getFirestore,
  type CollectionReference,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore'

import type { StudioId, TenantContext } from '../../../shared'
import type { ProjectionRepository } from '../application/ports'
import { applyIncrement, emptyDaily, type DailyIncrement, type DailyReadModel } from '../domain/daily'

const fromDoc = (date: string, d: DocumentData): DailyReadModel => ({
  ...emptyDaily(date),
  ...(d as Partial<DailyReadModel>),
  salesByProduct: (d.salesByProduct as Record<string, number>) ?? {},
  date,
})

export class FirestoreProjectionRepository implements ProjectionRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId): CollectionReference {
    // `readModels/daily/{date}` — a sub-collection, so the whole projection can be dropped and
    // rebuilt without touching anything else in the studio.
    return this.db.collection('studios').doc(sid).collection('readModels').doc('daily').collection('days')
  }

  async getDaily(ctx: TenantContext, date: string): Promise<DailyReadModel | null> {
    const snap = await this.col(ctx.studioId).doc(date).get()
    const d = snap.data()
    return d ? fromDoc(date, d) : null
  }

  async listDaily(ctx: TenantContext, from: string, to: string): Promise<readonly DailyReadModel[]> {
    // One ranged query for the whole chart: 30 days is 30 documents, not 30 queries.
    const snap = await this.col(ctx.studioId)
      .where('__name__', '>=', this.col(ctx.studioId).doc(from))
      .where('__name__', '<=', this.col(ctx.studioId).doc(to))
      .get()
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => (a.date < b.date ? -1 : 1))
  }

  async applyOnce(
    ctx: TenantContext,
    eventId: string,
    recordedAt: number, // LOG time — the clock `projection_lag` reads. Never domain time.
    inc: DailyIncrement,
  ): Promise<boolean> {
    const dayRef = this.col(ctx.studioId).doc(inc.date)
    const markerRef = dayRef.collection('applied').doc(eventId)

    return this.db.runTransaction(async (tx) => {
      const [daySnap, markerSnap] = await Promise.all([tx.get(dayRef), tx.get(markerRef)])
      if (markerSnap.exists) return false // a redelivery — the counter has already moved

      const current = daySnap.exists ? fromDoc(inc.date, daySnap.data() ?? {}) : emptyDaily(inc.date)
      const next = applyIncrement(current, inc, recordedAt)
      tx.set(dayRef, next)
      tx.set(markerRef, { at: recordedAt })
      return true
    })
  }

  async clearAll(ctx: TenantContext): Promise<void> {
    const days = await this.col(ctx.studioId).get()
    for (const day of days.docs) {
      const markers = await day.ref.collection('applied').get()
      const batch = this.db.batch()
      for (const m of markers.docs) batch.delete(m.ref)
      batch.delete(day.ref)
      await batch.commit()
    }
  }
}
