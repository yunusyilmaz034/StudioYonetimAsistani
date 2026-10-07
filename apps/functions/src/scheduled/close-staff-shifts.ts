import * as logger from 'firebase-functions/logger'

import {
  FirestoreStaffBreakRepository,
  FirestoreStaffShiftRepository,
  closeOpenBreakWithShift,
  closeShiftsAtLastCrossing,
  systemClock,
  type SystemJobId,
} from '@studio/core'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// GECE 23:00 — AÇIK MESAİ, O GÜNÜN SON TURNİKE GEÇİŞİNE KAPANIR (owner, 2026-09-13 · OR-74).
//
// *"Eğitmenlerin gün içinde ilk QR okutması mesai başlangıcı, son okutması mesai çıkışı sayılsın."*
//
// "Son okutma" ancak gün bitince bilinebilir — 17:00'deki bir geçiş çıkış mı, kargoya mı, gün içinde
// söylenemez. O yüzden anlık değil gece işi. Kapanış saati İŞİN ÇALIŞTIĞI AN DEĞİL, son gözlenen
// geçiştir; olayın `occurredAt`i de odur.
//
// Bu iş kaçarsa hiçbir şey bozulmaz: ertesi günün ilk geçişi dünden kalan vardiyayı aynı kurala göre
// önce kapatır (`decideStaffCrossing`, kural 2). İş yalnızca owner'ın AKŞAM listesinin doğru olması için.
//
// Geçişi olmayan (elle açılmış) vardiyalara DOKUNULMAZ: `system` gözlenmemiş bir bitiş yazamaz (#11).
//
// AÇIK KALAN MOLA DA BURADA KAPANIR (owner kararı, 2026-10-07 · OR-119). Vardiyası kapanan birinin
// molası açık kalırsa haftalık çizelge o molayı hiç saymaz ve ertesi gün "zaten moladasın" diye
// yeni molayı reddeder. Mola vardiyanın kapandığı ana kapanır ve `auto_closed` diye işaretlenir:
// gözlenmiş bir bitiş yok, ve kâğıtta ayrı görünür (#11).
//
// Vardiyadan AYRI bir işlem, bilerek: iki belge, her biri kendi olayıyla atomik (#1). Arada iş
// ölürse mola açık kalır — ertesi gece bu vardiya artık açık listede olmadığı için kapanmaz; o
// yüzden mola kapanışı başarısız olursa log HATA basar, susmaz.
const JOB_ID = 'staff_shift_close' as SystemJobId

export async function runStaffShiftClose(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreStaffShiftRepository(database), clock: systemClock }
  const molaDeps = { repo: new FirestoreStaffBreakRepository(database), clock: systemClock }
  for (const sid of await listStudioIds(database)) {
    const ctx = systemTenantContext(sid, JOB_ID)
    // Kapanacak vardiyalar kapanmadan ÖNCE okunuyor: kapandıktan sonra açık listede yoklar.
    const kapanacak = (await deps.repo.listOpenShifts(ctx)).filter((v) => v.lastCrossingAt !== null)
    const res = await closeShiftsAtLastCrossing(deps, ctx)
    let breaksClosed = 0
    for (const v of kapanacak) {
      try {
        breaksClosed += (await closeOpenBreakWithShift(molaDeps, ctx, v, v.lastCrossingAt!)).closed
      } catch (e) {
        logger.error('staff break close failed', { studioId: sid, shiftId: v.id, error: String(e) })
      }
    }
    logger.info('staff shift close', { studioId: sid, ...res, breaksClosed })
  }
}
