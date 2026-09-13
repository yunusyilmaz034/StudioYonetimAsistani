import * as logger from 'firebase-functions/logger'

import { FirestoreStaffShiftRepository, closeShiftsAtLastCrossing, systemClock, type SystemJobId } from '@studio/core'

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
const JOB_ID = 'staff_shift_close' as SystemJobId

export async function runStaffShiftClose(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreStaffShiftRepository(database), clock: systemClock }
  for (const sid of await listStudioIds(database)) {
    const res = await closeShiftsAtLastCrossing(deps, systemTenantContext(sid, JOB_ID))
    logger.info('staff shift close', { studioId: sid, ...res })
  }
}
