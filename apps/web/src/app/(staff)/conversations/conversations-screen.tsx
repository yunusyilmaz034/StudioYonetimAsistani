'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BotIcon, SendIcon, UserRoundIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import {
  getConversationAction,
  listConversationsAction,
  replyConversationAction,
  setConversationStatusAction,
  type ConvDetail,
  type ConvSummary,
  type Temp,
} from '@/server/actions/conversations'

const time = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const POLL_MS = 5000

const TEMP_DOT: Record<Temp, string> = { sıcak: 'bg-rose-500', ılık: 'bg-amber-500', soğuk: 'bg-slate-400' }
const TEMP_LABEL: Record<Temp, string> = { sıcak: '🔴 Sıcak', ılık: '🟡 Ilık', soğuk: '⚪ Soğuk' }

type Filter = 'all' | 'hot' | 'waiting' | 'human'

export function ConversationsScreen() {
  const [convs, setConvs] = useState<readonly ConvSummary[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConvDetail | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const params = useSearchParams()

  // Deep link from the dashboard checklist (?phone=…) — open that conversation on load.
  useEffect(() => {
    const phone = params.get('phone')
    if (phone) setSelected(phone)
  }, [params])

  const poll = useCallback(async () => {
    try {
      setConvs(await listConversationsAction())
    } catch {
      /* keep last */
    }
  }, [])
  useEffect(() => {
    void poll()
    const iv = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(iv)
  }, [poll])

  useEffect(() => {
    if (!selected) return setDetail(null)
    let alive = true
    const load = async () => {
      try {
        const d = await getConversationAction({ phone: selected })
        if (alive) setDetail(d)
      } catch {
        /* keep */
      }
    }
    void load()
    const iv = setInterval(() => void load(), POLL_MS)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [selected])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [detail?.messages.length])

  const shown = convs.filter((c) =>
    filter === 'hot' ? c.temp === 'sıcak' : filter === 'waiting' ? c.needsAttention : filter === 'human' ? c.status === 'human' : true,
  )

  async function send() {
    if (!selected || !text.trim()) return
    setBusy(true)
    try {
      const res = await replyConversationAction({ phone: selected, text: text.trim() })
      if (res.ok) {
        setText('')
        setDetail(await getConversationAction({ phone: selected }))
      } else toast.error('Gönderilemedi (24 saat penceresi dışı olabilir).')
    } catch {
      toast.error('Gönderilemedi.')
    }
    setBusy(false)
  }

  async function handOff(status: 'ai' | 'human') {
    if (!selected) return
    await setConversationStatusAction({ phone: selected, status }).catch(() => {})
    setDetail((d) => (d ? { ...d, status } : d))
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Sohbetler" description="WhatsApp AI resepsiyonistinin tüm konuşmaları — canlı ve geçmiş." />

      <div className="flex flex-wrap gap-1.5">
        {([['all', 'Tümü'], ['waiting', 'Bekleyen'], ['hot', 'Sıcak'], ['human', 'İnsan yönetiyor']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${filter === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
        {/* list */}
        <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
          {shown.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">Sohbet yok.</li>
          ) : (
            shown.map((c) => (
              <li key={c.phone}>
                <button type="button" onClick={() => setSelected(c.phone)} className={`flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/40 ${selected === c.phone ? 'bg-muted/50' : ''}`}>
                  <span className={`mt-1 size-2 shrink-0 rounded-full ${c.temp ? TEMP_DOT[c.temp] : 'bg-muted-foreground/30'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{c.name || c.phone.slice(-6)}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{time(c.lastAt).slice(0, 5)}</span>
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{c.lastText || '—'}</span>
                    {c.needsAttention ? <span className="mt-0.5 inline-block rounded bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-700">operatör bekliyor</span> : null}
                  </span>
                  {c.status === 'human' ? <UserRoundIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> : <BotIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />}
                </button>
              </li>
            ))
          )}
        </ul>

        {/* thread */}
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-card">
          {!selected || !detail ? (
            <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Bir sohbet seç.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{detail.name || detail.phone}</p>
                  <p className="text-xs text-muted-foreground">
                    {detail.temp ? `${TEMP_LABEL[detail.temp]} · ` : ''}
                    {detail.reason || (detail.status === 'human' ? 'Sen yönetiyorsun' : 'AI yönetiyor')}
                  </p>
                </div>
                {detail.status === 'human' ? (
                  <button type="button" onClick={() => void handOff('ai')} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-muted/40">AI’ya geri ver</button>
                ) : (
                  <button type="button" onClick={() => void handOff('human')} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-muted/40">Devral</button>
                )}
              </div>
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4">
                {detail.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${m.role === 'user' ? 'bg-card text-foreground shadow-sm' : 'bg-emerald-600 text-white'}`}>
                      {m.text}
                      <div className={`mt-0.5 text-[10px] ${m.role === 'user' ? 'text-muted-foreground' : 'text-white/70'}`}>{time(m.at).slice(-5)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-2 border-t border-border p-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  rows={1}
                  placeholder="Yanıt yaz… (devralınca AI susar)"
                  className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                />
                <button type="button" onClick={() => void send()} disabled={busy || !text.trim()} className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white disabled:opacity-50">
                  <SendIcon className="size-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
