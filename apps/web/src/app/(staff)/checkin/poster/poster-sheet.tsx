'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, PrinterIcon } from 'lucide-react'
import QRCode from 'qrcode'

import { Button } from '@/components/ui/button'

// The sheet itself. Two audiences on one page, separated by `print:hidden` / `hidden print:block`:
// reception sees instructions and a print button on screen; the printer sees only the poster.
//
// Sized for a member standing at the desk with a phone in one hand: the QR fills most of the page,
// the instruction is one sentence, and the date is printed large — because the ONE way this fails
// operationally is yesterday's sheet still being taped to the desk, and the fix is that anyone
// walking past can see the date is wrong.

const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'UTC',
  })
}

export function PosterSheet({
  studioName,
  token,
  studioId,
  day,
  validUntil,
}: {
  studioName: string
  token: string
  studioId: string
  day: string
  validUntil: number
}) {
  const [png, setPng] = useState<string | null>(null)
  // ── Left on a screen, this page must not outlive its code (2026-07-29) ──────────────────────
  //
  // The sheet is printed daily, but reception may also leave it open on a second monitor so the
  // code refreshes itself instead of being reprinted. A tab opened yesterday would happily keep
  // showing yesterday's QR: still rendered, still scannable, and dead. Members would scan it, get
  // "kod geçersiz", and nobody would connect the two — the screen looks fine.
  //
  // So the page reloads itself the moment the code expires. A one-minute cushion covers clock skew
  // between this browser and the server that will verify the scan.
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const msLeft = validUntil - Date.now()
    if (msLeft <= 0) {
      setExpired(true)
      return
    }
    const t = setTimeout(() => {
      setExpired(true)
      window.location.reload()
    }, msLeft + 60_000)
    return () => clearTimeout(t)
  }, [validUntil])

  // The scanned URL. It carries the studio so a member who is not signed in can be sent to HER
  // studio's login and back to this exact sheet.
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/g/${encodeURIComponent(
    token,
  )}?s=${encodeURIComponent(studioId)}`

  useEffect(() => {
    // Error correction H: this sheet will be taped up, curled at a corner, and photographed at an
    // angle under studio lighting. The extra redundancy costs resolution we have plenty of on A4.
    void QRCode.toDataURL(url, { errorCorrectionLevel: 'H', margin: 1, width: 1400 })
      .then(setPng)
      .catch(() => setPng(null))
  }, [url])

  return (
    <>
      {/* ── Reception's view ─────────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-3xl px-4 py-6 pb-24 print:hidden">
        <Link
          href="/checkin"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Giriş ekranı
        </Link>
        <h1 className="text-h1 font-semibold">Günlük Giriş Kâğıdı</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Bu sayfayı yazdırıp resepsiyona koyun. Üyeler kendi telefonlarının kamerasıyla okutup giriş
          yapar; giriş yapıldığında ekranınızın sağ üstünde bildirim çıkar. Dersi olan üyenin yoklaması
          da aynı anda alınır.
        </p>
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
          <p className="font-medium">Kâğıt her sabah yenilenir.</p>
          <p className="mt-1 text-muted-foreground">
            Bu kod yalnızca <strong>{dayLabel(day)}</strong> günü, saat{' '}
            {new Date(validUntil).toLocaleTimeString('tr-TR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Istanbul',
            })}
            'a kadar geçerlidir. Ertesi gün eski kâğıt çalışmaz — yenisini yazdırın.
          </p>
        </div>
        <Button className="mt-4 min-h-11" onClick={() => window.print()} disabled={!png}>
          <PrinterIcon className="size-4" /> Yazdır
        </Button>

        {expired ? (
          <div className="mt-4 rounded-xl border-2 border-danger/50 bg-danger/10 p-4">
            <p className="font-medium text-danger">Bu kodun günü doldu.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sayfa kendini yeniliyor. Yenilenmezse tarayıcıyı tazeleyin (⌘R) ve yeni kâğıdı yazdırın.
            </p>
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border bg-card p-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Önizleme</p>
          {png && !expired ? (
            /* A plain <img>: the source is a data: URI generated in this browser, so there is nothing
               for next/image to optimise and no remote host to allow. */
            <img src={png} alt="Giriş QR kodu" className="mx-auto w-56" />
          ) : (
            <p className="text-sm text-muted-foreground">Kod hazırlanıyor…</p>
          )}
        </div>
      </main>

      {/* ── What the printer sees ────────────────────────────────────────────────────────── */}
      <div className="hidden print:block">
        <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-10 text-center text-black">
          <div>
            <p className="text-4xl font-semibold">{studioName}</p>
            <p className="mt-3 text-3xl">Girişinizi telefonunuzla okutun</p>
          </div>
          {png && !expired ? (
            /* Same data: URI — see above. */
            <img src={png} alt="" className="w-[16cm]" />
          ) : null}
          <div className="space-y-2">
            <p className="text-2xl">Kamerayı kodun üzerine tutun, çıkan bağlantıya dokunun.</p>
            <p className="text-xl">Dersiniz varsa yoklamanız da otomatik alınır.</p>
          </div>
          {/* Large and unmissable: a stale sheet is the only way this quietly stops working. */}
          <p className="mt-2 text-2xl font-semibold">{dayLabel(day)}</p>
          <p className="text-base">Bu kâğıt yalnızca bugün geçerlidir.</p>
        </div>
      </div>
    </>
  )
}
