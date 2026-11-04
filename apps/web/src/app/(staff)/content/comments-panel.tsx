'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import { domainErrorMessage } from '@/lib/domain-error'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import {
  dismissIgCommentAction,
  hideIgCommentAction,
  igCommentsAction,
  replyIgCommentAction,
  type CommentResult,
  type CommentRow,
  type CommentsView,
} from '@/server/actions/ig-comments'

// IG-3 — onaylı tasarım: https://claude.ai/artifact/FNkjQST98xtMXcwrt3Bnze
// The AI sorts and drafts; a person sends. Complaints and hiding are the owner's.

type Tab = 'open' | 'complaint' | 'replied' | 'all'
const TABS: readonly [Tab, string][] = [
  ['open', 'Bekleyen'],
  ['complaint', 'Şikâyet'],
  ['replied', 'Cevaplanan'],
  ['all', 'Tümü'],
]
const CAT: Record<CommentRow['category'], { label: string; cls: string }> = {
  question: { label: 'Soru', cls: 'bg-info/10 text-info' },
  praise: { label: 'Övgü', cls: 'bg-success/10 text-success' },
  complaint: { label: 'Şikâyet', cls: 'bg-destructive/10 text-destructive' },
  spam: { label: 'Spam', cls: 'bg-warning/15 text-warning' },
  other: { label: 'Diğer', cls: 'bg-muted text-muted-foreground' },
}
const STATUS: Record<CommentRow['status'], string> = { open: 'Bekliyor', replied: 'Cevaplandı', hidden: 'Gizlendi', dismissed: 'Geçildi', closed: 'Eski' }
const ago = (t: number) => {
  const m = Math.max(1, Math.round((Date.now() - t) / 60_000))
  return m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`
}
const when = (t: number) => new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })

function explain(r: CommentResult): string {
  if (r.ok) return ''
  return r.error.code === 'meta_refused' ? `Instagram kabul etmedi: ${r.error.message}` : domainErrorMessage(r.error)
}

export function CommentsPanel() {
  const [tab, setTab] = useState<Tab>('open')
  const [view, setView] = useState<CommentsView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [counts, setCounts] = useState<{ open: number; complaint: number } | null>(null)

  const load = useCallback(async (t: Tab) => {
    try {
      const [v, open] = await Promise.all([igCommentsAction({ tab: t }), t === 'open' ? null : igCommentsAction({ tab: 'open' })])
      setView(v)
      const o = t === 'open' ? v : open!
      setCounts({ open: o.rows.length, complaint: o.rows.filter((r) => r.category === 'complaint').length })
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Yorumlar yüklenemedi.')
    }
  }, [])
  useEffect(() => void load(tab), [load, tab])

  async function act(key: string, f: () => Promise<CommentResult>, okMsg: string) {
    setBusy(key)
    try {
      const r = await f()
      if (!r.ok) toast.error(explain(r))
      else {
        toast.success(okMsg)
        setEditing(null)
      }
      await load(tab)
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : (e as Error)?.message || 'İşlem tamamlanamadı.')
    }
    setBusy(null)
  }

  const label = (t: Tab, l: string) => (t === 'open' && counts ? `${l} ${counts.open}` : t === 'complaint' && counts ? `${l} ${counts.complaint}` : l)

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Yorumlar" description="Instagram gönderilerine gelen yorumlar · 10 dakikada bir yenilenir. AI ayırır ve taslak yazar; cevabı siz gönderirsiniz." />
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([t, l]) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`min-h-9 rounded-full border px-3 text-xs ${tab === t ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'border-border bg-card'}`}>
            {label(t, l)}
          </button>
        ))}
      </div>

      {view === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
        </p>
      ) : view.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {tab === 'open' ? 'Cevap bekleyen yorum yok.' : tab === 'complaint' ? 'Bekleyen şikâyet yok.' : 'Burada henüz yorum yok.'}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {view.rows.map((c) => {
            const complaint = c.category === 'complaint'
            const open = c.status === 'open'
            const ed = editing?.id === c.id ? editing : null
            return (
              <li key={c.id} className={`space-y-2 rounded-xl border bg-card p-3 ${complaint && open ? 'border-l-4 border-l-destructive border-border' : 'border-border'}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">@{c.username}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.mediaLabel || 'Gönderi'} · {ago(c.commentedAt as number)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${CAT[c.category].cls}`}>{CAT[c.category].label}</span>
                  {!open ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">{STATUS[c.status]}</span> : null}
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.text}</p>

                {c.status === 'replied' && c.reply ? (
                  <p className="rounded-lg bg-success/10 px-3 py-2 text-xs">
                    <b>Cevaplandı</b> · {c.handledAt ? when(c.handledAt as number) : ''} · {c.reply.edited ? 'düzenlenerek' : 'taslak düzenlenmeden'}
                    <br />“{c.reply.text}”
                  </p>
                ) : null}

                {open && c.lastFailure ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs">Instagram kabul etmedi: “{c.lastFailure.message}”. Hiçbir şey gönderilmedi.</p> : null}

                {open && c.mayAct ? (
                  ed ? (
                    <div className="space-y-2">
                      <label className="sr-only" htmlFor={`reply-${c.id}`}>Cevap</label>
                      <textarea id={`reply-${c.id}`} value={ed.text} maxLength={2200} rows={4} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} className="w-full rounded-lg border-[1.5px] border-primary bg-background p-2.5 text-sm" />
                      <p className="text-xs text-muted-foreground">Açık yorumda fiyat yazılmaz. {ed.text.length}/2.200</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-lg border border-border bg-card text-sm">
                          Vazgeç
                        </button>
                        <button type="button" disabled={busy !== null || !ed.text.trim()} onClick={() => void act(`r${c.id}`, () => replyIgCommentAction({ id: c.id, text: ed.text }), 'Cevap gönderildi.')} className="min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
                          {busy === `r${c.id}` ? 'Gönderiliyor…' : 'Gönder'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {c.draft ? (
                        <div className="rounded-lg border border-dashed border-primary bg-primary/5 px-3 py-2 text-sm">
                          <b className="block text-[11px] uppercase tracking-wide text-primary">AI taslağı{complaint ? ' · dikkatli' : ''}</b>
                          {c.draft}
                        </div>
                      ) : c.category === 'spam' ? (
                        <p className="text-xs text-muted-foreground">AI cevap yazmadı.{view.isOwner ? '' : ' Gizlemek için sahibin onayı gerekir.'}</p>
                      ) : null}
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={busy !== null || !c.draft}
                          onClick={() => void act(`r${c.id}`, () => replyIgCommentAction({ id: c.id, text: c.draft ?? '' }), 'Cevap gönderildi.')}
                          className="min-h-10 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          {busy === `r${c.id}` ? '…' : 'Gönder'}
                        </button>
                        <button type="button" disabled={busy !== null} onClick={() => setEditing({ id: c.id, text: c.draft ?? '' })} className="min-h-10 rounded-lg border border-border bg-card text-sm">
                          {c.draft ? 'Düzenle' : 'Cevap yaz'}
                        </button>
                        <button type="button" disabled={busy !== null} onClick={() => void act(`d${c.id}`, () => dismissIgCommentAction({ id: c.id }), 'Geçildi.')} className="min-h-10 rounded-lg border border-border bg-card text-sm">
                          Geç
                        </button>
                      </div>
                    </>
                  )
                ) : open && complaint ? (
                  <p className="text-xs text-muted-foreground">Şikâyetleri sahip cevaplar. Ona e-posta gitti.</p>
                ) : null}

                {view.isOwner && (open || c.status === 'closed') ? (
                  <button type="button" disabled={busy !== null} onClick={() => void act(`h${c.id}`, () => hideIgCommentAction({ id: c.id }), 'Yorum Instagram’da gizlendi.')} className="min-h-10 w-full rounded-lg border border-border bg-card text-sm text-destructive disabled:opacity-50">
                    Gizle (Instagram’da gizler, silmez)
                  </button>
                ) : null}
                {c.mediaPermalink && !open ? (
                  <a href={c.mediaPermalink} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-primary">
                    <ExternalLinkIcon className="size-3.5" /> Instagram’da aç
                  </a>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
