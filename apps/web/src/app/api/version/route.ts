// ── HANGİ SÜRÜM ÇALIŞIYOR? (owner, 2026-09-22) ───────────────────────────────────────────────
//
// *"Çok sıkıntı yaşıyoruz — iki bilgisayarda aynı."* Işıl'ın iki sekmesi de sabahtan açıktı; gün
// içinde üç deploy çıktı ve o sekmelerdeki kod sunucuda artık yoktu. Üye kaydı, paket satışı,
// hepsi *"Kaydedilemedi. Lütfen tekrar deneyin."* dedi — ve tekrar denemek, yapılabilecek TEK yanlış
// şeydi: 17:58–17:59 arasında saniyede bir 404, hiçbiri sunucuya ulaşmadan.
//
// Hata METNİNE bakarak anlamayı deniyorduk (`lib/stale-deployment.ts`) ve o gün tutmadı: Next'in
// istemciye verdiği mesaj, sunucunun logladığı "Failed to find Server Action" değil. Metin tahmini
// kırılgan bir zemin — sürüm karşılaştırması değil.
//
// Bu uç nokta o zemini veriyor: çalışan revizyonun adı. Sayfa yüklenirken tarayıcıya gömülen ad ile
// buradan dönen ad farklıysa, o sekme eskidir. Tahmin yok.
//
// `K_REVISION` Cloud Run'ın her konteynere verdiği değişkendir (App Hosting'de
// `studio-yonetim-build-YYYY-MM-DD-NNN`). Yerelde yoktur; orada 'dev' döner ve karşılaştırma hiçbir
// zaman tetiklenmez — geliştirirken sayfanın kendi kendine yenilenmesi istenmez.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(
    { v: process.env.K_REVISION ?? 'dev' },
    // Ara katmanların önbelleğe almaması şart: önbellekten dönen bir sürüm numarası, sorunun ta
    // kendisini gizler.
    { headers: { 'cache-control': 'no-store, max-age=0' } },
  )
}
