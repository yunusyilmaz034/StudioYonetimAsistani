import * as logger from 'firebase-functions/logger'

import { FirestoreFinanceRepository, closeDrawer, money, openDrawer, systemClock, type SystemJobId } from '@studio/core'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// ── KASA GÜNLÜK DÖNGÜSÜ (owner kararı, 2026-09-05) ──────────────────────────────────────────
//
// Owner: *"Bir kasa otomatik olarak gün sonunda saat 23'te kapansın, sabah 09:00'da açılsın."*
//
// Sebebi ölçülmüştü: Merkez Kasa 17 Temmuz'dan 4 Eylül'e kadar AÇIK kaldı ve beklenen bakiye
// 774.061 ₺'ye çıktı. Kimse gün sonu yapmıyordu, ve yapmayan bir kasa hiç kapanmıyor.
//
// ── İTİRAZ EDİLDİ, OWNER KARAR VERDİ, VE KAYIT YALAN SÖYLEMİYOR ─────────────────────────────
//
// Bu işe itiraz ettim ve gerekçem kodun kendi yorumunda yazılıydı: *"sayıları sessizce uydurup
// denkleştiren bir gün sonu, bir kontrol değil, bir örtbastır."* Otomatik kapanış hiçbir çekmece
// sayamaz; sayım iddiası taşırsa hiç yapılmamış bir sayımın kaydını üretir.
//
// Owner tekrar istedi ve karar onun. Ama kapanış **sayım iddiası taşımıyor**: `counted` beklenene
// eşit yazılıyor çünkü domain bir sayı istiyor, ve NOT her kapanışta bunun ne anlama geldiğini
// SÖZLE söylüyor — "SAYIM YAPILMADI". Kasa raporunda notu okuyan, farkın sıfır olmasının bir denklik
// değil, bir bilgisizlik olduğunu görür.
//
// **Elle yapılan gün sonu bunun yerini alır ve almalıdır.** Gerçek sayım, farkı olan tek kapanıştır;
// bu döngü yalnızca kasanın sonsuza kadar açık kalmasını engelliyor.
//
// ── AÇILIŞ NEDEN SIFIRDAN ───────────────────────────────────────────────────────────────────
//
// Sabah kasa **0 ₺ ile** açılıyor. Yani `expected`, o GÜNÜN nakit hareketini gösteriyor; devreden
// bir bakiye taşımıyor. Devretseydi, ilk günün 774 binlik hatası her sabah yeniden doğardı.
// Çekmecede fiziksel olarak kalan para, bankaya yatırıldığında `bank_deposit` çıkışıyla yazılır —
// onun yeri burası değil.

// İki AYRI iş kimliği: log'da ve olay aktöründe "kim kapattı / kim açtı" ayrı ayrı okunabilsin.
// Tek bir kimlik, iki farklı işi aynı ada yazardı ve hangisinin ne yaptığı kaybolurdu (#5).
const KAPANIS_JOB = 'drawer_auto_close' as SystemJobId
const ACILIS_JOB = 'drawer_auto_open' as SystemJobId

const KAPANIS_NOTU =
  'Otomatik gün sonu (23:00) — SAYIM YAPILMADI. Fark sıfır görünüyorsa denklik değil, sayılmamış olmasıdır.'

/** 23:00 — açık kalan her kasayı kapat. */
export async function runDrawerAutoClose(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreFinanceRepository(database), clock: systemClock }
  for (const studioId of await listStudioIds(database)) {
    const ctx = systemTenantContext(studioId, KAPANIS_JOB)
    try {
      const drawers = await deps.repo.listDrawers(ctx)
      for (const d of drawers) {
        if (d.status !== 'open') continue
        // `counted` = beklenen. Bir sayım YOK; notu bunu söylüyor ve domain bir sayı olmadan
        // kapatmıyor. Fark sıfır çıkacak, ve raporun okuyacağı cümle notta.
        const r = await closeDrawer(deps, ctx, { drawerId: d.id, counted: money(d.expected.amount), note: KAPANIS_NOTU })
        if (!r.ok) logger.warn('[drawer-cycle] kapatılamadı', { studioId, drawerId: d.id, error: r.error })
        else logger.info('[drawer-cycle] kapatıldı', { studioId, drawerId: d.id, beklenen: d.expected.amount })
      }
    } catch (e) {
      // Bir stüdyonun hatası ötekileri durdurmaz — döngü tek bir stüdyo için değil.
      logger.error('[drawer-cycle] kapanış hatası', { studioId, message: (e as Error)?.message })
    }
  }
}

/** 09:00 — kapalı olan her AKTİF kasayı sıfır açılışla aç. */
export async function runDrawerAutoOpen(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreFinanceRepository(database), clock: systemClock }
  for (const studioId of await listStudioIds(database)) {
    const ctx = systemTenantContext(studioId, ACILIS_JOB)
    try {
      const drawers = await deps.repo.listDrawers(ctx)
      for (const d of drawers) {
        // Arşivlenmiş kasa açılmaz: emekliye ayrılmış bir kasayı her sabah diriltmek, listeyi
        // kimsenin kullanmadığı kasalarla doldurur.
        if (d.status === 'open' || d.active === false) continue
        const r = await openDrawer(deps, ctx, { drawerId: d.id, openingFloat: money(0) })
        if (!r.ok) logger.warn('[drawer-cycle] açılamadı', { studioId, drawerId: d.id, error: r.error })
        else logger.info('[drawer-cycle] açıldı', { studioId, drawerId: d.id })
      }
    } catch (e) {
      logger.error('[drawer-cycle] açılış hatası', { studioId, message: (e as Error)?.message })
    }
  }
}
