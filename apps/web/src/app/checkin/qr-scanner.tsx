'use client'

import { useEffect, useRef, useState } from 'react'

// Minimal typing for the native BarcodeDetector (Chrome/Android). Progressive
// enhancement — the manual "Üye Ara" path is the guaranteed fallback where it's absent.
interface DetectedBarcode {
  readonly rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

export function QrScanner({ onScan, active }: { onScan: (value: string) => void; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<'unsupported' | 'camera' | null>(null)

  useEffect(() => {
    if (!active) return
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!Ctor) {
      setError('unsupported')
      return
    }
    const detector = new Ctor({ formats: ['qr_code'] })
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        const v = videoRef.current
        if (!v) return
        v.srcObject = stream
        await v.play()
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const value = codes[0]?.rawValue
            if (value) onScan(value)
          } catch {
            /* transient decode error — keep scanning */
          }
          timer = window.setTimeout(() => void tick(), 350)
        }
        void tick()
      } catch {
        setError('camera')
      }
    }
    void start()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, onScan])

  if (error === 'unsupported') {
    return <p className="text-sm text-muted-foreground">Bu cihaz kamera taramayı desteklemiyor. Üye arayın.</p>
  }
  if (error === 'camera') {
    return <p className="text-sm text-danger">Kameraya erişilemedi. Üye arayın.</p>
  }
  return <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black object-cover" muted playsInline />
}
