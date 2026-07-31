'use client'

import { useEffect, useRef, useState } from 'react'

import { startQrScanner, type ScanError } from '@/lib/qr/scanner'

// The camera. Everything it knows about QR is `startQrScanner` — not the library, not the canvas,
// not the frame rate (v1.27 S4). It knows nothing about WHO is holding the device either: reception
// scans a member's code with it, and a member scans the printed sheet with it (2026-07-31). Hence
// `fallbackHint` — the "and here is what to do instead" half of a camera failure is the caller's,
// because "üye arayın" is advice only reception can act on.
//
// It behaves identically on an iPad and on an Android tablet, because there is only one
// implementation. Until today there were effectively zero on Safari: the studio's tablet IS an iPad,
// and this screen said "bu cihaz kamera taramayı desteklemiyor" to every member who held up her QR.

const MESSAGE: Record<ScanError, string> = {
  camera_denied: 'Kamera izni verilmedi. Tarayıcı ayarlarından izin verin.',
  no_camera: 'Kamera bulunamadı.',
}

export function QrScanner({
  onScan,
  active,
  className,
  fallbackHint,
}: {
  onScan: (value: string) => void
  active: boolean
  className?: string
  /** What to do when the camera will not open — different advice for reception and for a member. */
  fallbackHint?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<ScanError | null>(null)

  // The parent re-renders on every scan; the camera must not restart because its callback changed.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!active) return
    const video = videoRef.current
    if (!video) return

    setError(null)
    let handle: { stop: () => void } | null = null
    let cancelled = false

    void startQrScanner({
      video,
      onDecode: (value) => onScanRef.current(value),
      onError: setError,
    }).then((h) => {
      if (cancelled) h.stop() // unmounted while the camera was still opening
      else handle = h
    })

    return () => {
      cancelled = true
      handle?.stop()
    }
  }, [active])

  if (error) {
    return (
      <p className="text-sm text-danger">
        {MESSAGE[error]}
        {fallbackHint ? ` ${fallbackHint}` : ''}
      </p>
    )
  }

  return (
    <video
      ref={videoRef}
      className={className ?? 'aspect-video w-full rounded-lg bg-black object-cover'}
      muted
      playsInline
    />
  )
}
