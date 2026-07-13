import jsQR from 'jsqr'

// THE QR SCANNER — one port, one implementation, one behaviour (v1.27 S4 · owner, 2026-07-13).
//
// ── Why not `BarcodeDetector` ────────────────────────────────────────────────────────────────
// It is native, it is fast, and **Safari does not have it.** The studio's tablet is an iPad, so
// until today the camera simply did not work: the screen said "bu cihaz kamera taramayı
// desteklemiyor" and reception typed names for every member who walked in.
//
// ── Why not BOTH ─────────────────────────────────────────────────────────────────────────────
// A "use the native one when available, fall back otherwise" layer is the obvious design and it is
// the wrong one. **Two implementations are two behaviours** — different decode timing, different
// tolerance for a blurry frame, different failure modes — and the difference is discovered on the
// one device nobody tested, on the morning of go-live. One code path. Everywhere. The 12 kB is the
// cheapest insurance in this repository.
//
// ── What the rest of the app knows about QR ──────────────────────────────────────────────────
// This function, and nothing else. Not the library, not the canvas, not the frame rate. Replacing
// jsQR is a change to this file.

export interface ScanHandle {
  /** Stop the camera and release the device. Idempotent. */
  readonly stop: () => void
}

export type ScanError = 'camera_denied' | 'no_camera'

export interface ScanOptions {
  readonly video: HTMLVideoElement
  readonly onDecode: (value: string) => void
  readonly onError: (error: ScanError) => void
  /** How often a frame is examined. 250 ms keeps an old iPad cool and still feels instant. */
  readonly intervalMs?: number
}

export async function startQrScanner(options: ScanOptions): Promise<ScanHandle> {
  const { video, onDecode, onError, intervalMs = 250 } = options

  let stream: MediaStream | null = null
  let timer = 0
  let stopped = false

  const stop = () => {
    stopped = true
    window.clearTimeout(timer)
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // The BACK camera. A kiosk facing the member scans what she holds up, not her face.
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  } catch (err) {
    // Denied and absent are different problems with different answers — "izin verin" versus
    // "isimle giriş yapın" — and telling her the wrong one wastes her morning.
    onError((err as Error)?.name === 'NotAllowedError' ? 'camera_denied' : 'no_camera')
    return { stop }
  }

  video.srcObject = stream
  video.setAttribute('playsinline', 'true') // iOS Safari fullscreens the video without it
  await video.play().catch(() => undefined)

  // ONE canvas, reused. Allocating a new one per frame is how a tablet gets hot and then slow.
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })

  const tick = () => {
    if (stopped || !context) return

    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      const frame = context.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(frame.data, frame.width, frame.height, {
        // The token is printed on a light screen; inverted codes are not something we ever emit,
        // and looking for them doubles the work on every frame for nothing.
        inversionAttempts: 'dontInvert',
      })
      if (code?.data) onDecode(code.data)
    }

    timer = window.setTimeout(tick, intervalMs)
  }
  tick()

  return { stop }
}
