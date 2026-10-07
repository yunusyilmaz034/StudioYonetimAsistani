// ── GÜN İÇİ SAAT ('HH:MM') — tarafsız, tek cevap ───────────────────────────────────────────
//
// Bu dosya `week-plan.ts` ile `working-time.ts` arasındaki DÖNGÜYÜ kırmak için var. İkisi de aynı
// soruyu soruyor — "10:00 kaç dakikadır" — ve bu sorunun tek bir cevabı olmalı. Yardımcıları
// plan dosyasında bırakmak, hesap dosyasının plan dosyasına bağımlı olması demekti; plan dosyası da
// sınırları doğrulamak için hesap dosyasına bağlanınca graf kendi kuyruğunu yedi.
//
// Kopyalamak seçenek değildi: kopya, "10:00 kaç dakikadır" sorusuna iki ayrı cevap demek olurdu.
// `shared`'a koymak da değildi — bunlar vardiya saatinin biçimi, platformun değil.

export const SAAT = /^([01]\d|2[0-3]):([0-5]\d)$/
/**
 * 'HH:MM' → gün içindeki dakika. Geçersizse `NaN` — çağıran bunu kontrol eder.
 *
 * DIŞA VERİLDİ (2026-10-07): çalışma süresi hesabı da aynı ayrıştırmaya ihtiyaç duyuyor ve ikinci
 * bir kopya, iki farklı "10:00 kaç dakikadır" cevabı demek olurdu.
 */
export const dakika = (hhmm: string): number => {
  const m = SAAT.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN
}

/** 'HH:MM' biçim denetimi — çalışma süresi hesabı da bunu kullanıyor. */
export const gecerliSaat = (hhmm: string): boolean => SAAT.test(hhmm)
