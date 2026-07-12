'use client'

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Loader2Icon, RefreshCwIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { mintCheckInTokenAction, qrStudioBranchAction } from '@/server/actions/qr'

// D10/D15/D16 — the member's check-in QR.
//
// It encodes a SHORT-LIVED, server-signed, single-use token — never her memberId. A screenshot
// is worthless: it expires in a minute, and the first scan burns it. The code refreshes itself
// while the screen is open, so she never has to think about it.
//
// Online-only by design: her phone had to reach the server to display this at all.
const REFRESH_MARGIN_MS = 5_000

export function PortalQrScreen() {
  const [image, setImage] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [branchId, setBranchId] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [left, setLeft] = useState(0)

  const mint = useCallback(async (branch: string) => {
    try {
      const t = await mintCheckInTokenAction({ branchId: branch })
      setImage(await QRCode.toDataURL(t.token, { width: 280, margin: 1 }))
      setExpiresAt(t.expiresAt)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    qrStudioBranchAction()
      .then((s) => {
        if (!s.branchId) {
          setError(true)
          return
        }
        setBranchId(s.branchId)
        void mint(s.branchId)
      })
      .catch(() => setError(true))
  }, [mint])

  // Refresh before it dies, so the code on screen is always live.
  useEffect(() => {
    if (!expiresAt || !branchId) return
    const tick = setInterval(() => {
      const remaining = expiresAt - Date.now()
      setLeft(Math.max(0, Math.ceil(remaining / 1000)))
      if (remaining <= REFRESH_MARGIN_MS) void mint(branchId)
    }, 1000)
    return () => clearInterval(tick)
  }, [expiresAt, branchId, mint])

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-8">
      <div>
        <h1 className="text-display font-semibold text-foreground">QR Kodum</h1>
        <p className="text-sm text-muted-foreground">Girişte resepsiyona okutun.</p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 shadow-sm">
        {error ? (
          <p className="text-center text-sm text-muted-foreground">
            QR kod oluşturulamadı. İnternet bağlantınızı kontrol edin — bağlantı yoksa resepsiyon
            sizi manuel olarak kaydedebilir.
          </p>
        ) : image ? (
          <>
            {/* A data: URI QR — next/image would add nothing but a round-trip. */}
            <img src={image} alt="Check-in QR kodu" className="size-64 rounded-lg" />
            <p className="text-xs tabular-nums text-muted-foreground">
              {left > 0 ? `${left} saniye geçerli · otomatik yenilenir` : 'Yenileniyor…'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => branchId && mint(branchId)}
              disabled={!branchId}
            >
              <RefreshCwIcon /> Yenile
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Hazırlanıyor…
          </p>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Bu kod kısa ömürlüdür ve tek kullanımlıktır. Ekran görüntüsü paylaşmayın — çalışmaz.
      </p>
    </main>
  )
}
