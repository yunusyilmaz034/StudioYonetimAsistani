'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CameraIcon, CheckCircle2Icon, Loader2Icon, RefreshCwIcon, XIcon } from 'lucide-react'

import { QrScanner } from '@/components/qr-scanner'
import { Button } from '@/components/ui/button'
import { track } from '@/lib/analytics'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  memberScanCheckInAction,
  mintCheckInTokenAction,
  qrStudioBranchAction,
} from '@/server/actions/qr'
import {
  getLocationConsentAction,
  recordCheckinLocationAction,
  setLocationConsentAction,
} from '@/server/actions/location'

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
  // KVKK location consent (owner: member's own phone only). null = still loading.
  const [locConsent, setLocConsent] = useState<boolean | null>(null)
  const [locSaving, setLocSaving] = useState(false)
  const [captured, setCaptured] = useState(false)
  // The OTHER direction: she scans the studio's printed sheet with her own camera (2026-07-31).
  const [scanning, setScanning] = useState(false)
  const [scanState, setScanState] = useState<{ ok: boolean; text: string } | null>(null)
  // One scan is enough. jsQR decodes the same frame several times a second, and without this the
  // second decode arrives while the first request is still open — two check-ins from one hold-up.
  const busyRef = useRef(false)

  useEffect(() => {
    getLocationConsentAction()
      .then((r) => setLocConsent(r.granted))
      .catch(() => setLocConsent(false))
  }, [])

  // One coarse, best-effort ping per screen visit, and only with consent. The browser prompt is the
  // second gate; a denial or any failure is silent — this never blocks the QR she came here for.
  useEffect(() => {
    if (!locConsent || captured) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    setCaptured(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void recordCheckinLocationAction({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }).catch(() => {})
        track('location_captured', { surface: 'member_qr' })
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    )
  }, [locConsent, captured])

  async function toggleConsent(next: boolean) {
    setLocSaving(true)
    try {
      await setLocationConsentAction({ granted: next })
      setLocConsent(next)
      if (!next) setCaptured(false)
    } catch {
      /* best-effort */
    } finally {
      setLocSaving(false)
    }
  }

  const mint = useCallback(async (branch: string) => {
    try {
      const t = await mintCheckInTokenAction({ branchId: branch })
      setImage(await QRCode.toDataURL(t.token, { width: 280, margin: 1 }))
      setExpiresAt(t.expiresAt)
      setError(false)
      track('qr_scanned', { surface: 'member' })
    } catch {
      setError(true)
    }
  }, [])

  const onScan = useCallback(async (value: string) => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const res = await memberScanCheckInAction({ token: value })
      if (res.ok) {
        setScanning(false)
        setScanState({
          ok: true,
          text: res.value.direction === 'in' ? 'Giriş kaydedildi. İyi antrenmanlar!' : 'Çıkış kaydedildi.',
        })
        track('qr_scanned', { surface: 'member_portal_scan' })
      } else {
        setScanState({ ok: false, text: domainErrorMessage(res.error) })
      }
    } catch {
      setScanState({ ok: false, text: 'Kayıt alınamadı. İnternet bağlantınızı kontrol edin.' })
    } finally {
      // A refusal is worth re-reading the same code for (she may be pointing at yesterday's sheet
      // and swap it); a success closed the camera already.
      window.setTimeout(() => {
        busyRef.current = false
      }, 2500)
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

      {/* The other direction — she scans the studio's code instead of showing hers. Reception prints
          a sheet every morning and it hangs at the door; until today only the mobile app could read
          it, and most of this studio's members were invited to the web portal (owner, 2026-07-31).
          The camera opens on a PRESS, never on load: a page that asks for the camera by itself is a
          page people close. */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-medium text-foreground">Stüdyodaki kodu okut</h2>
          <p className="text-xs text-muted-foreground">
            Girişteki QR kodunu telefonunuzun kamerasıyla okutarak kendiniz giriş yapabilirsiniz.
          </p>
        </div>

        {scanState ? (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
              scanState.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
            }`}
          >
            {scanState.ok ? (
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
            ) : (
              <XIcon className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{scanState.text}</span>
          </div>
        ) : null}

        {scanning ? (
          <>
            <QrScanner
              active
              onScan={(v) => void onScan(v)}
              className="aspect-square w-full rounded-lg bg-black object-cover"
              fallbackHint="QR kodunuzu resepsiyona okutabilirsiniz."
            />
            <Button
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => {
                setScanning(false)
                busyRef.current = false
              }}
            >
              Kamerayı Kapat
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => {
              setScanState(null)
              setScanning(true)
            }}
          >
            <CameraIcon /> Kamerayı Aç
          </Button>
        )}
      </section>

      {/* KVKK location consent — opt-in, member's own phone only, coarse, never blocks check-in. */}
      {locConsent !== null ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
          <input
            type="checkbox"
            checked={locConsent}
            disabled={locSaving}
            onChange={(e) => void toggleConsent(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">Konumumu paylaşmayı kabul ediyorum.</span>{' '}
            Giriş yaparken yaklaşık konumum (KVKK kapsamında, yalnızca bu telefondan) stüdyoyla
            paylaşılır. İstediğiniz zaman kapatabilirsiniz; kapattığınızda kayıtlarınız silinir.
          </span>
        </label>
      ) : null}
    </main>
  )
}
