'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, BotIcon, MessageCircleIcon, SendIcon, UserRoundIcon, XIcon, Loader2Icon } from 'lucide-react'
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

import { mesajZamani } from '@/lib/mesaj-zamani'
const POLL_MS = 4000

// "WP Hattı" — the floating operator dock. It lives in the staff layout, so it SURVIVES page navigation
// (never closes/freezes) and stays a small panel in the bottom-right: reception keeps working on the
// left while chatting on the right. It polls the conversations every few seconds; when the AI hands one
// off (needsAttention), a toast fires on whatever screen is open and the dock pops to that
// conversation. Reception can take over, reply, and hand back to the AI.
//
// THREE kinds of handover, three different alerts, because they are three different jobs:
//   🟢 devir     — the assistant working as designed; auto-dismisses
//   🔥 satışa hazır — she said she wants to sign up; STAYS on screen until acted on, and is also sent
//                    out of the building by e-mail, because the person who needs it is often not at
//                    a desk (whatsapp-webhook.ts → tellTheDesk)
//   ⚠️ hata      — a customer is sitting unanswered and nobody would know; an alarm, not a notice
export function WhatsAppDock() {
  const [open, setOpen] = useState(false)
  const [convs, setConvs] = useState<readonly ConvSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConvDetail | null>(null)
  const [text, setText] = useState('')
  /** Sohbet yüklenemedi. Boş bir kutu göstermek yerine söylüyoruz — sessiz hata en kötüsü. */
  const [yuklemeHatasi, setYuklemeHatasi] = useState(false)
  // AÇIKÇA "YÜKLENİYOR" (owner, 2026-09-01). Bir sohbete tıklayınca panel bomboş kalıyordu: hata
  // yoktu, içerik de yoktu, ve ekran hiçbir şey söylemiyordu. Owner'ın cümlesi: *"yüklenecekse
  // loading gelsin bari."* Geçen sefer yalnızca HATA durumunu eklemiştim — bekleme durumunu değil,
  // ve resepsiyonun gördüğü şey tam olarak oydu.
  const [yukleniyor, setYukleniyor] = useState(false)
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
            // Two reasons, two sentences. A handoff is the assistant working as designed; a failure
            // means a customer is sitting unanswered and nobody would know — the second is an alarm,
            // not a notification, so it does not auto-dismiss.
            if (c.attentionReason === 'ai_failed') {
              toast.error(`⚠️ Asistan cevap veremedi · ${c.name || c.phone.slice(-4)} bekliyor`, { duration: Infinity })
            } else if (c.attentionReason === 'hot_lead') {
              // Someone who has just said she is ready to buy. It does NOT auto-dismiss: a sale that
              // waits until tomorrow is the cold call the studio was already complaining about, and a
              // toast that disappears after five seconds is a toast nobody saw.
              toast(`🔥 SATIŞA HAZIR · ${c.name || c.phone.slice(-4)} · hemen yazın`, {
                duration: Infinity,
                className: 'border-2 border-warning bg-warning/10 font-semibold',
              })
            } else {
              toast.success(`🟢 Operatör devri geliyor · ${c.name || c.phone.slice(-4)}`, { duration: 5000 })
            }
            setOpen(true)
            // AÇIK SOHBETİ ÇALMA (2026-08-30). Burası eskiden doğrudan `setSelected(c.phone)`
            // yapıyordu: resepsiyon bir sohbeti okurken gelen yoklama onu başka birine atıyordu.
            // Kullanıcı geri dönüp tekrar tıklıyor, yoklama tekrar çalıyor — "konuşmalar gelmiyor"
            // diye görünen şey buydu. Uyarı yine çıkıyor ve dock yine açılıyor; sadece elindeki
            // konuşma elinden alınmıyor.
            setSelected((cur) => cur ?? c.phone)
          }
          // Cleared (a human took it, or the AI answered after all) → forget it, so the NEXT time
          // this same person needs the desk the alert fires again. Without this, every conversation
          // could raise exactly one alert for the lifetime of the tab.
          if (!c.needsAttention) seen.current.delete(c.phone)
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
        if (!alive) return
        setDetail(d)
        setYukleniyor(false)
        // `null` = sohbet bulunamadı. Bu da bir hata: boş bir pencere, kullanıcıya sistemin
        // çalıştığını ama konuşmanın olmadığını düşündürüyor.
        setYuklemeHatasi(d === null)
      } catch {
        // Sessizce yutmuyoruz. Eski içerik duruyorsa kalsın, ama hiç içerik yoksa söyle.
        if (alive) {
          setYuklemeHatasi(true)
          setYukleniyor(false)
        }
      }
    }
    // ÖNCEKİ SOHBETİ HEMEN TEMİZLE. Aksi halde B'ye tıklayınca A'nın mesajları ekranda kalıyor ve
    // yeni sohbet yüklenene kadar YANLIŞ konuşma okunuyor — boş ekrandan daha kötü.
    setDetail(null)
    setYuklemeHatasi(false)
    setYukleniyor(true)
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
        className="fixed right-4 bottom-[136px] z-50 flex h-12 items-center gap-2 rounded-full border border-border bg-emerald-600 px-4 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 md:bottom-[72px]"
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
    <div className="fixed right-4 bottom-[136px] z-50 flex h-[min(64vh,560px)] w-[min(92vw,384px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl md:bottom-[72px]">
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
                        <span className="shrink-0 text-[11px] text-muted-foreground">{mesajZamani(c.lastAt)}</span>
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
            {/* YÜKLENMEDEN HÜKÜM VERME. `detail` boşken bu satır varsayılan dala düşüp güvenle
                "🤖 AI yönetiyor" diyor ve "Devral" sunuyordu — henüz okunmamış bir sohbetin durumu
                hakkında. O düğmeye basmak, bilinmeyen bir durumu değiştirmek olurdu. */}
            <span className="text-muted-foreground">
              {!detail ? '…' : detail.status === 'human' ? '👤 Sen yönetiyorsun' : '🤖 AI yönetiyor'}
            </span>
            {!detail ? null : detail.status === 'human' ? (
              <button type="button" onClick={() => void handOff('ai')} className="font-medium text-emerald-700 hover:underline">AI’ya geri ver</button>
            ) : (
              <button type="button" onClick={() => void handOff('human')} className="font-medium text-amber-600 hover:underline">Devral</button>
            )}
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/20 p-3">
            {yukleniyor && !detail ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Sohbet yükleniyor…
              </div>
            ) : null}
            {/* Yüklendi ama içi boş: bu da bir cevap, ve boş ekrandan farklı bir cevap. */}
            {!yukleniyor && !yuklemeHatasi && detail && detail.messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Bu sohbette henüz mesaj yok.</p>
            ) : null}
            {yuklemeHatasi && !detail ? (
              // Boş bir pencere "sohbet yok" gibi okunuyor ve resepsiyon geri dönüp tekrar tıklıyor.
              // Ne olduğunu söylemek, sessizce boş kalmaktan her zaman iyi.
              <div className="space-y-2 py-6 text-center">
                <p className="text-sm text-muted-foreground">Sohbet yüklenemedi.</p>
                <button
                  type="button"
                  onClick={() => {
                    const p = selected
                    setSelected(null)
                    setTimeout(() => setSelected(p), 0)
                  }}
                  className="text-sm font-medium text-emerald-700 hover:underline"
                >
                  Tekrar dene
                </button>
              </div>
            ) : null}
            {(detail?.messages ?? []).map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${m.role === 'user' ? 'bg-card text-foreground' : 'bg-emerald-600 text-white'}`}>
                  {m.text}
                  <div className={`mt-0.5 text-[10px] ${m.role === 'user' ? 'text-muted-foreground' : 'text-white/70'}`}>{mesajZamani(m.at)}</div>
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
