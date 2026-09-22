'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { isStaleDeployment } from '@/lib/stale-deployment'

// ── PANELİN HATA EKRANI (owner, 2026-09-22) ──────────────────────────────────────────────────
//
// *"Resepsiyon sistem bazen donuyor, arada çok yavaş diyor."*
//
// Panelde bu güne kadar hiç hata sınırı yoktu: bir sayfa render sırasında düşerse React ağacı
// boşalıyor ve ekranda hiçbir şey kalmıyordu. Resepsiyonun gördüğü şey buydu — beyaz ekran, tepki
// vermeyen sayfa, "dondu". Hata bir yere yazılmıyor, kimseye bir şey söylenmiyordu.
//
// İKİ AYRI DURUM, iki ayrı cevap:
//
//   • SEKME ESKİ KALDI — panele yeni bir sürüm çıktı ve bu sekmedeki kod artık sunucuda yok. Tek
//     çare yenilemek, ve bunu kullanıcıdan istemenin anlamı yok: kendimiz yapıyoruz.
//   • GERÇEK HATA — o zaman yenilemek çözmez. Sayfa ne olduğunu söyler ve iki yol bırakır:
//     tekrar dene (React'in kendi `reset`'i) ya da yenile.
//
// Kasten SADE: masada müşteri bekliyor, kimse yığın izini okumayacak.
export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const eskiSekme = isStaleDeployment(error)

  useEffect(() => {
    if (eskiSekme) {
      const t = window.setTimeout(() => window.location.reload(), 1500)
      return () => window.clearTimeout(t)
    }
    // Gerçek hatayı sunucu loglarında aramak için: digest, Cloud Logging'deki kaydın kimliğidir.
    console.error('[panel] beklenmeyen hata', { digest: error.digest, message: error.message })
    return undefined
  }, [eskiSekme, error])

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg font-semibold text-foreground">
        {eskiSekme ? 'Panelin yeni sürümü yayınlandı' : 'Bir şeyler ters gitti'}
      </p>
      <p className="text-sm text-muted-foreground">
        {eskiSekme
          ? 'Bu sekme eski kalmıştı. Sayfa kendiliğinden yenileniyor — bir saniye.'
          : 'Bu sayfa açılırken bir hata oldu. Tekrar deneyin; geçmezse sayfayı yenileyin.'}
      </p>
      {eskiSekme ? null : (
        <div className="flex gap-2">
          <Button onClick={() => reset()}>Tekrar dene</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Sayfayı yenile
          </Button>
        </div>
      )}
      {error.digest && !eskiSekme ? (
        <p className="text-xs tabular-nums text-muted-foreground">Hata kodu: {error.digest}</p>
      ) : null}
    </div>
  )
}
