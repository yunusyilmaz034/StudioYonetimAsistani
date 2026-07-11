'use client'

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'

import { Button } from '@/components/ui/button'

// The member's check-in QR (D1: encodes the opaque memberId). Auto-generated,
// regenerable (stable — re-render, since it is memberId-based), and printable.
// Generated client-side, self-contained — no external call.
export function MemberQrCard({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  const generate = useCallback(() => {
    QRCode.toDataURL(memberId, { width: 240, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null))
  }, [memberId])

  useEffect(() => {
    generate()
  }, [generate])

  const print = () => {
    if (!dataUrl) return
    const w = window.open('', '_blank', 'width=420,height=560')
    if (!w) return
    w.document.write(
      `<title>${memberName}</title><div style="text-align:center;font-family:system-ui,sans-serif;padding:24px">` +
        `<img src="${dataUrl}" style="width:260px;height:260px" alt="QR"/>` +
        `<h2 style="margin:12px 0 4px">${memberName}</h2><p style="color:#667085">Giriş QR Kodu</p></div>`,
    )
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-center">
      {dataUrl ? (
        <img src={dataUrl} alt="Giriş QR kodu" className="mx-auto size-40" />
      ) : (
        <div className="mx-auto size-40 animate-pulse rounded bg-muted" />
      )}
      <p className="text-xs text-muted-foreground">Giriş/çıkış için okutun</p>
      <div className="flex justify-center gap-2">
        <Button variant="outline" size="sm" onClick={generate}>
          Yenile
        </Button>
        <Button variant="outline" size="sm" onClick={print} disabled={!dataUrl}>
          Yazdır
        </Button>
      </div>
    </div>
  )
}
