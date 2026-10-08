import {
  getFirestore,
  type CollectionReference,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore'

import type { StudioId, TenantContext } from '../../../shared'
import type { ProjectionRepository } from '../application/ports'
import { applyIncrement, emptyDaily, incrementTargets, type DailyIncrement, type DailyReadModel } from '../domain/daily'

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

    return this.db.runTransaction(
      async (tx) => {
        // One marker, on the event's OWN day, guards every day the increment touches: they are
        // written in this one transaction, so either all of them moved or none did.
        const targets = incrementTargets(inc, recordedAt).map((t) => ({ ...t, ref: this.col(ctx.studioId).doc(t.inc.date) }))
        const [markerSnap, ...daySnaps] = await Promise.all([tx.get(markerRef), ...targets.map((t) => tx.get(t.ref))])
        if (markerSnap.exists) return false // a redelivery — the counter has already moved

        targets.forEach((t, i) => {
          const snap = daySnaps[i]!
          const current = snap.exists ? fromDoc(t.inc.date, snap.data() ?? {}) : emptyDaily(t.inc.date)
          tx.set(t.ref, applyIncrement(current, t.inc, t.eventAt))
        })
        tx.set(markerRef, { at: recordedAt })
        return true
      },
      // ── AYNI BELGEYE YAZAN İKİ İŞLEM (production, 2026-09-27…29) ──────────────────────────
      //
      // Cloud Alerting üç gün üst üste `onEventCreated` hatası bildirdi ve altındaki gerçek hata
      // hep aynıydı: `ABORTED — cross-transaction contention`. Sebebi yapısal: o günün BÜTÜN
      // olayları (giriş, rezervasyon, ödeme) tek bir `days/{tarih}` belgesine yazıyor. Yoğun bir
      // dakikada ikisi çakışıyor, Firestore birini iptal ediyor, ve varsayılan deneme sayısı
      // tükenince SDK bunu "geçici değil" diye sınıflandırıp fırlatıyor.
      //
      // Kaybolan şey olay değil — olay yazıldı, tetikleyici onu yutmuyor. Kaybolan, o olayın
      // günlük sayaca EKLENMESİ: panodaki bir sayı bir eksik kalıyor ve `pnpm projections:rebuild`
      // çalışana kadar öyle duruyor. Haftada 5 kez, günde ~6.400 çağrıya karşılık.
      //
      // Daha fazla denemek burada GÜVENLİ, çünkü işlem zaten tam olarak bir kez uygulanacak
      // şekilde kurulu: `applied/{eventId}` işaretçisi varsa sayaç hiç oynatılmıyor. Yani tekrar
      // denemek bir sayıyı iki kez artıramaz — çakışmayı beklemekten başka bir şey yapmaz.
      { maxAttempts: 8 },
    )
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
