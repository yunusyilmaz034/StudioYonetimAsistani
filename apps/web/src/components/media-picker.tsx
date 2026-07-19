'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Loader2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { track } from '@/lib/analytics'
import { listMediaAction, uploadMediaAction, type MediaItem } from '@/server/actions/media'

// The reusable picker: opened wherever an image is needed, it uploads a new file OR picks one from the
// Media Center in a single step, then hands the URL back. One library, one upload path.
export function MediaPicker({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (o: boolean) => void; onSelect: (url: string) => void }) {
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) void listMediaAction().then((x) => setItems([...x])).catch(() => setItems([]))
  }, [open])

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const out = await uploadMediaAction({ dataUrl, name: file.name })
      if (out.ok) {
        track('image_uploaded', { where: 'media_center' })
        onSelect(out.value.url)
        onOpenChange(false)
      } else toast.error('Yüklenemedi.')
    } catch {
      toast.error('Yüklenemedi.')
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Medya Merkezi</DialogTitle>
        </DialogHeader>
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => void upload(e)} />
        <Button onClick={() => ref.current?.click()} disabled={busy} className="w-fit">
          {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon className="size-4" />} Yeni görsel yükle
        </Button>
        {items === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Henüz görsel yok — yukarıdan yükle.</p>
        ) : (
          <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                title={it.name}
                onClick={() => {
                  onSelect(it.url)
                  onOpenChange(false)
                }}
                className="aspect-square overflow-hidden rounded-lg border transition-colors hover:border-primary"
              >
                <img src={it.url} alt={it.name} className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
