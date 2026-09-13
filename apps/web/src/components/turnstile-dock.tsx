'use client'

import { useEffect, useState } from 'react'
import { LogInIcon, LogOutIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { listTurnstilesAction, openTurnstileAction } from '@/server/actions/turnstile'

// ── TURNİKE, HER EKRANIN SAĞ ÜSTÜNDE (owner, 2026-09-13) ────────────────────────────────────
//
// *"Resepsiyonda her zaman sayfanın en üst sağ köşesinde turnikeye giriş ve çıkış şeklinde 2 buton
// yap, buraya basınca turnike yönüne göre geçiş izni versin."*
//
// Düğme Check-in ekranında ZATEN vardı — ve sorun tam olarak oydu: kapıyı açması gereken an,
// resepsiyonun o ekranda olduğu an değil. Kargo gelir, misafir gelir, telefonu ölmüş bir üye
// bekler; resepsiyon o sırada üye kartında, takvimde ya da tahsilattadır. İki tık öteye konmuş bir
// acil düğme, kapıda bekleyen biri için iki tık uzaktır.
//
// İKİ AYRI DÜĞME, bilerek: tek düğme hangi kolun döneceğini resepsiyona tahmin ettirirdi ve yanlış
// tahmin "açılmadı" demektir.
//
// SABİT KONUM, akış içinde değil: sayfalar kendi başlığını çiziyor, ortak bir üst bar yok. Ekrana
// sabitlenmiş bir kontrol, "Bildir" ve "WP Hattı" ile aynı desen.

type Cihaz = Awaited<ReturnType<typeof listTurnstilesAction>>[number]

export function TurnstileDock() {
  const [cihazlar, setCihazlar] = useState<readonly Cihaz[] | null>(null)
  const [acilan, setAcilan] = useState<string | null>(null)

  useEffect(() => {
    const oku = () =>
      void listTurnstilesAction()
        .then((d) => setCihazlar(d.filter((x) => x.active)))
        .catch(() => setCihazlar([]))
    oku()
    // Yarım dakikada bir: "çevrimdışı" bilgisi bir kez çizilip donarsa yanlış olduğu anda da orada
    // durur — ve bu panel bütün gün açık kalıyor.
    const t = window.setInterval(oku, 60_000)
    return () => window.clearInterval(t)
  }, [])

  // Turnikesi olmayan stüdyoda HİÇ görünmez. Basılamayacak bir düğme, ekranda yer kaplar.
  if (!cihazlar || cihazlar.length === 0) return null

  const giris = cihazlar.find((c) => c.side === 'in')
  const cikis = cihazlar.find((c) => c.side === 'out')
  if (!giris && !cikis) return null

  async function ac(c: Cihaz, etiket: string) {
    setAcilan(c.id)
    try {
      const res = await openTurnstileAction({ deviceId: c.id, reason: 'Resepsiyon panelden açtı' })
      if (res.ok) toast.success(`${etiket} kapısı açıldı.`)
      else toast.error('Kapı açılamadı — cihaz çevrimdışı olabilir.')
    } catch {
      toast.error('Kapı açılamadı. Bağlantınızı kontrol edin.')
    } finally {
      setAcilan(null)
    }
  }

  // Cihaz otuz saniyedir konuşmadıysa söylüyoruz. Sessizce açılmayan bir kapı, resepsiyona
  // "bastım olmadı" dedirtir; çevrimdışı olduğunu bilmek, tekrar basmaktan iyidir.
  const cevrimdisi = (c: Cihaz) => c.lastSeenAt === null || Date.now() - c.lastSeenAt > 120_000

  const dugme = (c: Cihaz | undefined, etiket: string, Ikon: typeof LogInIcon) =>
    c ? (
      <Button
        size="sm"
        variant={cevrimdisi(c) ? 'outline' : 'secondary'}
        className="min-h-8 shadow-sm"
        disabled={acilan !== null}
        onClick={() => void ac(c, etiket)}
        title={cevrimdisi(c) ? `${etiket} kapısı çevrimdışı görünüyor` : `${etiket} kolunu aç`}
      >
        {acilan === c.id ? <Loader2Icon className="animate-spin" /> : <Ikon />}
        {etiket}
        {cevrimdisi(c) ? <span className="text-xs text-muted-foreground">·</span> : null}
      </Button>
    ) : null

  return (
    <div
      // BAŞLIK İLE İÇERİK ARASINDAKİ BOŞLUKTA (owner, 2026-09-13 → 14). İlk hâli sağ ÜST köşedeydi
      // ve sayfa başlığının düğmelerine ("Toplu İşlemler", "Analiz / Canlı akış") biniyordu; sonra
      // 104 px'e indi ve bu kez takvim kartının araç çubuğuna ("Ay / Hafta") bindi. Doğru yer ikisinin
      // ARASI: başlık düğmeleri ~62 px'te bitiyor, kartın içeriği ~114 px'te başlıyor. Düğmeler bu
      // aralığa sığsın diye bir kademe alçaldı (`min-h-8`).
      className="fixed right-3 top-[64px] z-40 flex gap-1.5 rounded-xl border border-border/60 bg-background/85 p-1 shadow-sm backdrop-blur md:right-4 md:top-[64px]"
      aria-label="Turnike"
    >
      {dugme(giris, 'Giriş', LogInIcon)}
      {dugme(cikis, 'Çıkış', LogOutIcon)}
    </div>
  )
}
