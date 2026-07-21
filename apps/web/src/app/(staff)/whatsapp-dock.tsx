'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, BotIcon, MessageCircleIcon, SendIcon, UserRoundIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  getConversationAction,
  listConversationsAction,
  markConversationSeenAction,
  replyConversationAction,
  setConversationStatusAction,
  type ConvDetail,
  type ConvSummary,
} from '@/server/actions/conversations'

const time = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const POLL_MS = 4000

// "WP Hattı" — the floating operator dock. It lives in the staff layout, so it SURVIVES page navigation
// (never closes/freezes) and stays a small panel in the bottom-right: reception keeps working on the
// left while chatting on the right. It polls the conversations every few seconds; when the AI hands one
// off (needsAttention), a green "operatör devri geliyor" toast fires on whatever screen is open and the
// dock pops to that conversation. Reception can take over, reply, and hand back to the AI.
export function WhatsAppDock() {
  const [open, setOpen] = useState(false)
  const [convs, setConvs] = useState<readonly ConvSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConvDetail | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const seen = useRef<Set<string>>(new Set())
  const baselined = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const attention = convs.filter((c) => c.needsAttention)

  const poll = useCallback(async () => {
    try {
      const list = await listConversationsAction()
      setConvs(list)
      // First load baselines what's already waiting (no toast storm for history); after that, a NEW
      // needsAttention conversation triggers the green handoff alert + auto-opens the dock.
      if (!baselined.current) {
        for (const c of list) if (c.needsAttention) seen.current.add(c.phone)
        baselined.current = true
      } else {
        for (const c of list) {
          if (c.needsAttention && !seen.current.has(c.phone)) {
            seen.current.add(c.phone)
            toast.success(`🟢 Operatör devri geliyor · ${c.name || c.phone.slice(-4)}`, { duration: 5000 })
            setOpen(true)
            setSelected(c.phone)
          }
        }
      }
    } catch {
      /* transient — keep the last list */
    }
  }, [])

  useEffect(() => {
    void poll()
    const iv = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(iv)
  }, [poll])

  // While a conversation is open, refresh its thread live (and mark it seen once).
  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    let alive = true
    const load = async () => {
      try {
        const d = await getConversationAction({ phone: selected })
        if (alive) setDetail(d)
      } catch {
        /* keep last */
      }
    }
    void load()
    void markConversationSeenAction({ phone: selected }).catch(() => {})
    seen.current.add(selected)
    const iv = setInterval(() => void load(), POLL_MS)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [selected])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [detail?.messages.length])

  async function send() {
    if (!selected || !text.trim()) return
    setBusy(true)
    try {
      const res = await replyConversationAction({ phone: selected, text: text.trim() })
      if (res.ok) {
        setText('')
        const d = await getConversationAction({ phone: selected })
        setDetail(d)
      } else {
        toast.error('Gönderilemedi (24 saat penceresi dışı olabilir).')
      }
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-50 flex h-12 items-center gap-2 rounded-full border border-border bg-emerald-600 px-4 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105"
        title="WhatsApp hattı"
      >
        <MessageCircleIcon className="size-5" />
        WP Hattı
        {attention.length > 0 ? (
          <span className="grid size-5 place-items-center rounded-full bg-white text-xs font-bold text-emerald-700">{attention.length}</span>
        ) : null}
      </button>
    )
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 flex h-[min(72vh,600px)] w-[min(92vw,384px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-emerald-600 px-3 py-2 text-white">
        <div className="flex items-center gap-2">
          {selected ? (
            <button type="button" onClick={() => setSelected(null)} className="rounded p-0.5 hover:bg-white/20" title="Geri">
              <ArrowLeftIcon className="size-4" />
            </button>
          ) : (
            <MessageCircleIcon className="size-4" />
          )}
          <span className="text-sm font-semibold">{selected ? detail?.name || 'Sohbet' : 'WP Hattı'}</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-0.5 hover:bg-white/20" title="Kapat">
          <XIcon className="size-4" />
        </button>
      </div>

      {!selected ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {convs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Henüz sohbet yok.</p>
          ) : (
            <ul className="divide-y divide-border">
              {convs.map((c) => (
                <li key={c.phone}>
                  <button type="button" onClick={() => setSelected(c.phone)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40">
                    <span className={`mt-1 size-2 shrink-0 rounded-full ${c.needsAttention ? 'bg-emerald-500' : c.status === 'human' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{c.name || c.phone.slice(-6)}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{time(c.lastAt)}</span>
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{c.lastText || '—'}</span>
                    </span>
                    {c.status === 'human' ? <UserRoundIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> : <BotIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">
              {detail?.status === 'human' ? '👤 Sen yönetiyorsun' : '🤖 AI yönetiyor'}
            </span>
            {detail?.status === 'human' ? (
              <button type="button" onClick={() => void handOff('ai')} className="font-medium text-emerald-700 hover:underline">AI’ya geri ver</button>
            ) : (
              <button type="button" onClick={() => void handOff('human')} className="font-medium text-amber-600 hover:underline">Devral</button>
            )}
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/20 p-3">
            {(detail?.messages ?? []).map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${m.role === 'user' ? 'bg-card text-foreground' : 'bg-emerald-600 text-white'}`}>
                  {m.text}
                  <div className={`mt-0.5 text-[10px] ${m.role === 'user' ? 'text-muted-foreground' : 'text-white/70'}`}>{time(m.at)}</div>
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
              placeholder="Yanıt yaz…"
              className="max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
            <button type="button" onClick={() => void send()} disabled={busy || !text.trim()} className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white disabled:opacity-50">
              <SendIcon className="size-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
