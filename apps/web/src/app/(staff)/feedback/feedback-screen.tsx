'use client'

import { useState } from 'react'
import { CheckIcon, ExternalLinkIcon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resolveBugReportAction, type BugReport } from '@/server/actions/feedback'

const ROLE_LABEL: Record<string, string> = { owner: 'Sahip', receptionist: 'Resepsiyon', trainer: 'Eğitmen' }
const when = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' })

export function FeedbackScreen({ initial }: { initial: BugReport[] }) {
  const [reports, setReports] = useState(initial)
  const [showResolved, setShowResolved] = useState(false)

  const shown = reports.filter((r) => showResolved || !r.resolved)
  const openCount = reports.filter((r) => !r.resolved).length

  async function toggle(r: BugReport) {
    const next = !r.resolved
    setReports((rs) => rs.map((x) => (x.id === r.id ? { ...x, resolved: next } : x)))
    try {
      await resolveBugReportAction({ id: r.id, resolved: next })
    } catch {
      setReports((rs) => rs.map((x) => (x.id === r.id ? { ...x, resolved: !next } : x)))
      toast.error('Güncellenemedi.')
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-display font-semibold text-foreground">Geri Bildirim</h1>
          <p className="text-sm text-muted-foreground">
            Personelin "Bildir" butonuyla gönderdiği sorunlar. {openCount} açık.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowResolved((s) => !s)}>
          {showResolved ? 'Sadece açık' : 'Tümü'}
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {reports.length === 0 ? 'Henüz bildirim yok.' : 'Açık bildirim yok.'}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl border border-border bg-card p-3 shadow-sm ${r.resolved ? 'opacity-60' : ''}`}
            >
              <div className="flex gap-3">
                {r.imageUrl ? (
                  <a
                    href={r.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative hidden h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40 sm:block"
                  >
                    <img src={r.imageUrl} alt="Ekran görüntüsü" className="size-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                      <ExternalLinkIcon className="size-5" />
                    </span>
                  </a>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-wrap text-foreground">{r.note || '—'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline">{ROLE_LABEL[r.role] ?? r.role}</Badge>
                    <code className="rounded bg-muted px-1.5 py-0.5">{r.page}</code>
                    <span>· {when(r.createdAt)}</span>
                    {r.resolved ? <Badge className="bg-success/10 text-success">Çözüldü</Badge> : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void toggle(r)} title={r.resolved ? 'Aç' : 'Çözüldü işaretle'}>
                  {r.resolved ? <RotateCcwIcon className="size-4" /> : <CheckIcon className="size-4" />}
                </Button>
              </div>
              {r.imageUrl ? (
                <a href={r.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline sm:hidden">
                  <ExternalLinkIcon className="size-3.5" /> Ekran görüntüsü
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
