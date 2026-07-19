'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { CopyIcon, ImageIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { deleteMediaAction, listMediaAction, uploadMediaAction, type MediaItem } from '@/server/actions/media'

const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })

export function MediaScreen({ initial, canManage }: { initial: MediaItem[]; canManage: boolean }) {
  const [items, setItems] = useState<MediaItem[]>(initial)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const reload = async () => setItems([...(await listMediaAction())])

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setBusy(true)
    try {
      for (const file of files) {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = rej
          r.readAsDataURL(file)
        })
        const out = await uploadMediaAction({ dataUrl, name: file.name })
        if (!out.ok) toast.error(`${file.name} yüklenemedi.`)
      }
      await reload()
      toast.success('Yüklendi.')
    } catch {
      toast.error('Yüklenemedi.')
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }

  async function remove(it: MediaItem) {
    if (!confirm('Bu görsel silinsin mi? Kullanıldığı yerlerde kırık görünebilir.')) return
    setBusy(true)
    try {
      await deleteMediaAction({ id: it.id })
      await reload()
      toast.success('Silindi.')
    } catch {
      toast.error('Silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Bağlantı kopyalandı.')
    } catch {
      toast.error('Kopyalanamadı.')
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-display font-semibold">Medya Merkezi</h1>
          <p className="text-sm text-muted-foreground">Yüklediğin tüm görseller. Panelde görsel gereken yerlerde buradan seçebilir, bağlantısını kopyalayabilirsin.</p>
        </div>
        {canManage ? (
          <>
            <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void upload(e)} />
            <Button onClick={() => ref.current?.click()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon className="size-4" />} Görsel Yükle
            </Button>
          </>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <ImageIcon className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Henüz görsel yok</p>
          <p className="mt-1 text-sm text-muted-foreground">Yukarıdan görsel yükleyerek başla.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((it) => (
            <li key={it.id} className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="aspect-square overflow-hidden bg-muted">
                <img src={it.url} alt={it.name} className="size-full object-cover" />
              </div>
              <div className="space-y-1.5 p-2.5">
                <p className="truncate text-xs font-medium" title={it.name}>{it.name}</p>
                <p className="text-[0.7rem] text-muted-foreground">{d(it.uploadedAt)}</p>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 flex-1 px-2 text-xs" onClick={() => void copy(it.url)}>
                    <CopyIcon className="size-3" /> Kopyala
                  </Button>
                  {canManage ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-danger" onClick={() => void remove(it)} disabled={busy}>
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
