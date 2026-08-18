'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2Icon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// GÖRSEL HİZALAMA — the owner drags the picture inside the frame the phone will actually show, and
// what he sees is what ships.
//
// WHY IT CROPS HERE INSTEAD OF ON THE PHONE. React Native's Image has no focal point: `cover` always
// crops from the centre. Teaching the app to honour an anchor is a mobile change, and a mobile change
// is a store release — a new build, Apple's review, and a week of members who have not updated seeing
// the old behaviour. Cropping in the panel produces a finished image, so the app that is ALREADY on
// every phone renders it correctly the moment the banner is saved.
//
// The original is never overwritten: the caller keeps `sourceUrl` and the transform, so "biraz daha
// yukarı alalım" reopens this dialog where it was left instead of starting from an upload.

export interface CropTransform {
  /** Centre of the visible window, as a fraction of the image (0–1). 0.5/0.5 is the centre. */
  readonly cx: number
  readonly cy: number
  /** 1 = the image exactly fills the frame's short side. Larger zooms in. */
  readonly zoom: number
}

export const DEFAULT_CROP: CropTransform = { cx: 0.5, cy: 0.5, zoom: 1 }

export function ImageCropDialog({
  open,
  onOpenChange,
  src,
  aspect,
  targetWidth,
  initial,
  title = 'Görseli hizala',
  hint,
  onApply,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** The ORIGINAL image. Never the previously-cropped one, or each edit would crop a crop. */
  src: string
  /** Frame width ÷ height. 2.5 for the home banner, 1 for the campaign popup. */
  aspect: number
  /** Output width in pixels. Height follows from `aspect`. */
  targetWidth: number
  initial?: CropTransform
  title?: string
  hint?: string
  onApply: (dataUrl: string, crop: CropTransform) => void | Promise<void>
}) {
  const [crop, setCrop] = useState<CropTransform>(initial ?? DEFAULT_CROP)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  useEffect(() => {
    if (open) setCrop(initial ?? DEFAULT_CROP)
    // Intentionally keyed on `open` alone: `initial` is a fresh object on every render of the
    // parent, and depending on it would re-seed the transform mid-drag.
  }, [open])

  // Intrinsic size, needed to convert a drag in screen pixels into a fraction of the image.
  useEffect(() => {
    if (!open || !src) return
    setNat(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => setNat(null)
    img.src = src
  }, [open, src])

  // The scale at which the image COVERS the frame, in frame-widths. Everything below is expressed
  // relative to the frame so the maths does not care how large the dialog is drawn.
  const cover = nat ? Math.max(1, (nat.w / nat.h) * (1 / aspect)) : 1
  const imgWidthPct = nat ? (nat.w / nat.h >= aspect ? cover : 1) * crop.zoom * 100 : 100

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const frame = frameRef.current
    if (!d || !frame || !nat) return
    const fw = frame.clientWidth
    const fh = frame.clientHeight
    // Rendered image size in screen pixels, at the current zoom.
    const renderedW = (imgWidthPct / 100) * fw
    const renderedH = renderedW * (nat.h / nat.w)
    // A drag of N pixels moves the window by N/rendered of the image.
    const nx = d.cx - (e.clientX - d.x) / renderedW
    const ny = d.cy - (e.clientY - d.y) / renderedH
    // Clamp so the frame can never show empty space beyond the edges.
    const halfX = fw / renderedW / 2
    const halfY = fh / renderedH / 2
    setCrop((c) => ({
      ...c,
      cx: halfX >= 0.5 ? 0.5 : Math.min(1 - halfX, Math.max(halfX, nx)),
      cy: halfY >= 0.5 ? 0.5 : Math.min(1 - halfY, Math.max(halfY, ny)),
    }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const apply = useCallback(async () => {
    if (!nat) return void toast.error('Görsel yüklenemedi.')
    setBusy(true)
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('load'))
        img.src = src
      })

      const outW = targetWidth
      const outH = Math.round(targetWidth / aspect)
      // The source rectangle: how much of the image the frame currently shows.
      const baseW = nat.w / nat.h >= aspect ? nat.h * aspect : nat.w
      const sw = baseW / crop.zoom
      const sh = sw / aspect
      const sx = crop.cx * nat.w - sw / 2
      const sy = crop.cy * nat.h - sh / 2

      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.imageSmoothingQuality = 'high'
      // Clamped so a rounding error at the edge cannot ask for pixels outside the image, which
      // draws a transparent strip instead of failing loudly.
      ctx.drawImage(
        img,
        Math.max(0, Math.min(nat.w - sw, sx)),
        Math.max(0, Math.min(nat.h - sh, sy)),
        sw,
        sh,
        0,
        0,
        outW,
        outH,
      )
      // JPEG, not PNG: this is a photograph or a poster, and a PNG of it is several megabytes on a
      // member's mobile data for no visible gain. 0.9 is indistinguishable at this size.
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      await onApply(dataUrl, crop)
      onOpenChange(false)
    } catch {
      // A canvas fed a cross-origin image that sends no CORS header is "tainted" and refuses to
      // export. Every image from the Media Center is fine; a pasted third-party URL may not be.
      toast.error('Bu görsel kırpılamadı. Dosyayı Medya Merkezi’ne yükleyip tekrar dene.')
    } finally {
      setBusy(false)
    }
  }, [nat, src, aspect, targetWidth, crop, onApply, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {hint ?? 'Çerçeve, üyenin telefonunda göreceği alandır. Görseli sürükleyerek hizala, kaydırıcıyla yakınlaştır.'}
        </p>

        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative w-full cursor-grab touch-none overflow-hidden rounded-xl border border-border bg-muted select-none active:cursor-grabbing"
          style={{ aspectRatio: String(aspect) }}
        >
          {src ? (
            <img
              alt=""
              src={src}
              crossOrigin="anonymous"
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: `${imgWidthPct}%`,
                left: '50%',
                top: '50%',
                // The window's centre is (cx, cy) of the image, so the image shifts by how far that
                // point sits from its own middle.
                transform: `translate(calc(-50% + ${(0.5 - crop.cx) * imgWidthPct}%), calc(-50% + ${(0.5 - crop.cy) * imgWidthPct * (nat ? nat.h / nat.w : 1)}%))`,
              }}
            />
          ) : null}

          {/* Rule-of-thirds guides, only while dragging feels useful — they are always on because a
              poster is aligned against its own edges more often than against a subject. */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
          </div>

          {/* Where the app paints its own gradient and text. Shown so nobody aligns a headline into
              the one band that is guaranteed to be covered. */}
          {aspect > 1.5 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/70 to-transparent">
              <span className="absolute bottom-1.5 left-2 text-[10px] font-medium tracking-wide text-white/70 uppercase">
                Başlık ve metin buraya biner
              </span>
            </div>
          ) : null}

          {!nat ? (
            <div className="absolute inset-0 grid place-items-center bg-background/60">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-sm text-muted-foreground">Yakınlaştır</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
            className="w-full accent-primary"
          />
          <Button type="button" variant="ghost" size="icon" title="Sıfırla" onClick={() => setCrop(DEFAULT_CROP)}>
            <RotateCcwIcon className="size-4" />
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="button" onClick={() => void apply()} disabled={busy || !nat}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null} Uygula
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
