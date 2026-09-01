'use client'

import { useEffect, useState } from 'react'
import { DoorOpenIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { listTurnstilesAction, openTurnstileAction } from '@/server/actions/turnstile'

// PANELDEN KAPIYI AÇ (owner, 2026-09-01).
//
// *"Panelden resepsiyon açabilmeli çift yönlü olarak turnikeyi."*
//
// İki sebep var ve ikisi de günlük: elinde telefon olmayan biri (misafir, kargo, personel), ve
// turnikenin bir sebeple okumadığı bir üye. İkisinde de resepsiyon zaten bu ekranda oluyor —
// düğmenin yeri burası, Ayarlar'ın içinde bir cihaz listesi değil.
//
// İKİ AYRI DÜĞME, bilerek: tek düğme resepsiyona hangi kolun döneceğini tahmin ettirirdi, ve yanlış
// tahmin kapıda bekleyen birine "açılmadı" dedirtir.
//
// Her açma SEBEBİYLE kaydediliyor. Kimin geçtiğini bilmiyoruz — bilmediğimiz şeyi yazmıyoruz — ama
// kimin açtığını biliyoruz, ve bir kapının kaydı olmayan hareketi sonradan kimsenin hesabını
// veremeyeceği bir harekettir.

type Cihaz = Awaited<ReturnType<typeof listTurnstilesAction>>[number]

const ETIKET: Record<string, string> = { in: 'Giriş', out: 'Çıkış' }

export function TurnstileOpen() {
  const [cihazlar, setCihazlar] = useState<readonly Cihaz[] | null>(null)
  const [acilan, setAcilan] = useState<string | null>(null)

  useEffect(() => {
    const oku = () =>
      void listTurnstilesAction()
        .then((d) => setCihazlar(d.filter((x) => x.active)))
        .catch(() => setCihazlar([]))
    oku()
    // Yarım dakikada bir tazeleniyor: "çevrimdışı" yazısı bir kez çizilip donarsa, yanlış olduğu
    // anda da orada durur — ve bu ekran bütün gün açık kalıyor.
    const t = window.setInterval(oku, 30_000)
    return () => window.clearInterval(t)
  }, [])

  // Turnikesi olmayan stüdyoda hiç görünmez. Basılamayacak bir düğme, ekranda yer kaplamaktan başka
  // bir şey yapmaz.
  if (!cihazlar || cihazlar.length === 0) return null

  async function ac(c: Cihaz) {
    setAcilan(c.id)
    try {
      const res = await openTurnstileAction({ deviceId: c.id, reason: 'Resepsiyon panelden açtı' })
      if (res.ok) toast.success(`${c.side ? ETIKET[c.side] : c.name} kapısı açıldı.`)
      else toast.error('Kapı açılamadı — cihaz çevrimdışı olabilir.')
    } catch {
      toast.error('Kapı açılamadı. Bağlantınızı kontrol edin.')
    } finally {
      setAcilan(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Turnike</span>
      {cihazlar.map((c) => {
        // KAPI YAŞIYOR MU? Cihaz kodunu ~25 saniyede bir tazeliyor ve her tazeleme `lastSeenAt`e
        // dokunuyor. 90 saniye sessizlik, bir gecikme değil bir arıza.
        //
        // Bu satır olmadan çevrimdışı bir kapıda "Aç" düğmesi hiçbir şey yapmaz ve resepsiyon bunu
        // düğmenin bozukluğu sanar — kapıda bekleyen biri varken en pahalı yanlış anlama bu.
        const cevrimdisi = c.lastSeenAt === null || Date.now() - c.lastSeenAt > 90_000
        return (
          <Button
            key={c.id}
            variant="outline"
            size="sm"
            onClick={() => void ac(c)}
            disabled={acilan !== null || cevrimdisi}
            title={cevrimdisi ? 'Cihaz çevrimdışı — kapı bu düğmeye cevap veremez.' : undefined}
          >
            {acilan === c.id ? <Loader2Icon className="size-4 animate-spin" /> : <DoorOpenIcon className="size-4" />}
            {c.side ? `${ETIKET[c.side]} kapısını aç` : `${c.name} — aç`}
            {cevrimdisi ? <span className="ml-1 text-xs text-muted-foreground">· çevrimdışı</span> : null}
          </Button>
        )
      })}
    </div>
  )
}
