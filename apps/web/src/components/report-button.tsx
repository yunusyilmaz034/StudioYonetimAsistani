'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2Icon, MessageSquareWarningIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { submitBugReportAction } from '@/server/actions/feedback'

// "Bildir" — a floating report button on every staff screen. Reception captures the page + writes a
// line instead of phoning the owner; it lands in the owner's Geri Bildirim list. `data-report-ignore`
// keeps the button (and any node marked with it) OUT of the screenshot.
export function ReportButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [shot, setShot] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [busy, setBusy] = useState(false)

  async function start() {
    setCapturing(true)
    setShot(null)
    setNote('')
    setOpen(true)
    try {
      // Import lazily so html-to-image never enters the bundle until reception actually reports.
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(document.body, {
        pixelRatio: 0.7,
        cacheBust: true,
        backgroundColor: '#ffffff',
        filter: (node) => !(node instanceof HTMLElement && node.dataset.reportIgnore !== undefined),
      })
      setShot(dataUrl)
    } catch {
      // A screenshot is best-effort — a page it can't render (a cross-origin canvas) still gets a note.
      setShot(null)
    } finally {
      setCapturing(false)
    }
  }

  async function submit() {
    if (!note.trim() && !shot) {
      toast.error('Bir not yaz ya da ekran görüntüsü bekle.')
      return
    }
    setBusy(true)
    try {
      const res = await submitBugReportAction({
        note: note.trim(),
        page: pathname,
        ...(shot ? { dataUrl: shot } : {}),
        userAgent: navigator.userAgent.slice(0, 300),
      })
      if (res.ok) {
        toast.success('Bildirim gönderildi. Teşekkürler!')
        setOpen(false)
      } else {
        toast.error('Gönderilemedi.')
      }
    } catch {
      toast.error('Gönderilemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        data-report-ignore
        onClick={() => void start()}
        title="Bir sorun bildir"
        className="fixed right-3 bottom-20 z-40 flex h-11 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-lg transition-colors hover:border-primary/50 hover:text-primary md:bottom-4"
      >
        <MessageSquareWarningIcon className="size-4" />
        Bildir
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? null : setOpen(false))}>
        <DialogContent className="max-w-lg" data-report-ignore>
          <DialogHeader>
            <DialogTitle>Sorun bildir</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid aspect-video place-items-center overflow-hidden rounded-lg border border-border bg-muted/40">
              {capturing ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" /> Ekran görüntüsü alınıyor…
                </span>
              ) : shot ? (
                <img src={shot} alt="Ekran görüntüsü" className="size-full object-contain" />
              ) : (
                <span className="text-sm text-muted-foreground">Ekran görüntüsü alınamadı — not yeter.</span>
              )}
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ne oldu? (örn. paket eklerken tarih yazınca hata verdi)"
              rows={3}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={() => void submit()} disabled={busy || capturing}>
              {busy ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
              Gönder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
