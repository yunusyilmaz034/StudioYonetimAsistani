'use client'

import { useEffect, useState } from 'react'

// ── BU SEKME ESKİDİ (owner, 2026-09-22) ──────────────────────────────────────────────────────
//
// *"Çok sıkıntı yaşıyoruz. İki bilgisayarda aynı."* — üye kaydı ve paket satışı kaydedilmiyordu.
// Panel çalışıyordu; ekrandaki kopya eskiydi. Gün içinde üç deploy çıkmıştı ve o sekmelerin
// çağırdığı Server Action'lar sunucuda yoktu: 17:58–17:59 arası saniyede bir 404, hiçbiri işlenmedi.
// Ekranda yazan "Kaydedilemedi. Lütfen tekrar deneyin." cümlesi, yapılabilecek tek yanlış şeyi
// söylüyordu — tekrar denemek, sekme yenilenene kadar ASLA çalışmaz.
//
// Şimdiye kadar bunu hatanın METNİNDEN anlamaya çalışıyorduk. O gün tutmadı ve tutmaya da mecbur
// değil: Next'in istemciye verdiği mesaj, sunucunun logladığı mesaj değil. Sürüm karşılaştırması
// tahmin değildir — sayfa yüklendiğindeki revizyon adı ile sunucunun şu an çalıştırdığı ad.
//
// ── NE ZAMAN KENDİ KENDİNE YENİLER, NE ZAMAN SORAR ──
//
// Sekme ARKA PLANDAYSA sessizce yeniler: kimse bir şey yazmıyor, kaybedilecek bir şey yok, ve
// resepsiyon o sekmeye döndüğünde güncel bir panel bulur — bu senaryonun tam kendisi.
// Sekme ÖNDEYSE yenilemez, söyler. Yarım doldurulmuş bir üye formunu ayağının altından çekmek,
// çözdüğünden büyük bir sorun yaratır; kararı masadaki insan verir.
const KONTROL_MS = 60_000

export function VersionWatch({ current }: { current: string }) {
  const [eskidi, setEskidi] = useState(false)

  useEffect(() => {
    // Yerelde (ve sürüm okunamadığında) hiç çalışmaz: geliştirirken sayfanın kendini yenilemesi
    // istenmez, ve bilinmeyen bir değeri "değişti" saymak yanlış alarmdır.
    if (!current || current === 'dev') return

    let durdu = false
    const bak = async () => {
      if (durdu || eskidi) return
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { v } = (await res.json()) as { v?: string }
        if (!v || v === current) return
        // Arka plandaki sekme sessizce tazelenir; öndeki sorar.
        if (document.hidden) window.location.reload()
        else setEskidi(true)
      } catch {
        // Ağ hatası bir sürüm değişikliği değildir. Sessiz kalmak doğru: bir kesintide "yeni sürüm
        // çıktı" demek, olmayan bir şeyi haber vermektir.
      }
    }
    const iv = window.setInterval(() => void bak(), KONTROL_MS)
    // Sekmeye dönüldüğü an da bakılır: gün içinde açık kalan bir sekmenin en kritik anı budur.
    const gorunurluk = () => {
      if (!document.hidden) void bak()
    }
    document.addEventListener('visibilitychange', gorunurluk)
    void bak()
    return () => {
      durdu = true
      window.clearInterval(iv)
      document.removeEventListener('visibilitychange', gorunurluk)
    }
  }, [current, eskidi])

  if (!eskidi) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 bg-warning px-4 py-2 text-sm font-medium text-white shadow-lg">
      <span>Panelin yeni bir sürümü yayınlandı. Bu sekme eski kaldı — kayıt yapılamaz.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-white/20 px-3 py-1 font-semibold transition-colors hover:bg-white/30"
      >
        Şimdi yenile
      </button>
    </div>
  )
}
