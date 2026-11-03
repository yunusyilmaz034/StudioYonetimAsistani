'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BotIcon, SendIcon, UserRoundIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import {
  getConversationAction,
  listInboxAction,
  replyConversationAction,
  setConversationStatusAction,
  type ConvDetail,
  type Inbox,
  type InboxItem,
  conversationNoteAction,
  setConversationNoteAction,
  type ConversationNote,
  type Temp,
} from '@/server/actions/conversations'

import { CHANNEL_LABEL, convLabel } from '@/lib/conv-label'
import { mesajZamani } from '@/lib/mesaj-zamani'
import { replyErrorText } from '@/lib/reply-error'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import { InboxSectionList, OlderConversationsButton, inboxSections, useOlderConversations } from '@/components/inbox-sections'
const POLL_MS = 5000

const TEMP_DOT: Record<Temp, string> = { sıcak: 'bg-rose-500', ılık: 'bg-amber-500', soğuk: 'bg-slate-400' }
const TEMP_LABEL: Record<Temp, string> = { sıcak: '🔴 Sıcak', ılık: '🟡 Ilık', soğuk: '⚪ Soğuk' }

type Filter = 'all' | 'hot' | 'waiting' | 'human' | 'draft'
type ChannelFilter = 'all' | 'whatsapp' | 'instagram'

// Kanal rozeti: WhatsApp yeşil (`success`), Instagram mor (`info`) — renk tek başına ayırt etmesin diye
// yanında her zaman adı yazar.
function ChannelBadge({ channel }: { channel: 'whatsapp' | 'instagram' }) {
  return channel === 'instagram' ? (
    <span className="inline-block rounded bg-info/15 px-1.5 text-[10px] font-semibold text-info">{CHANNEL_LABEL.instagram}</span>
  ) : (
    <span className="inline-block rounded bg-success/15 px-1.5 text-[10px] font-semibold text-success">{CHANNEL_LABEL.whatsapp}</span>
  )
}

export function ConversationsScreen() {
  const [convs, setConvs] = useState<readonly InboxItem[]>([])
  const [period, setPeriod] = useState<Inbox['period']>(null)
  const eski = useOlderConversations(period)
  const [filter, setFilter] = useState<Filter>('all')
  const [channel, setChannel] = useState<ChannelFilter>('all')
  // Taslağı düzenleme: açıkken metin buradadır, gönderilen de budur. Yoklama taslağı tazelese bile
  // kullanıcının yazdığı üstüne yazılmaz (aşağıdaki etki yalnızca sohbet değişince sıfırlar).
  const [draftEdit, setDraftEdit] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConvDetail | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // KALICI NOT (owner, 2026-10-02). Tik notundan ayrı: o "bu işi kapattım" der ve tik geri alınınca
  // silinir; bu ise kişinin kendisi hakkında kalan cümledir ("fiyatı yüksek buldu, Ocak'ta ara").
  const [note, setNote] = useState<ConversationNote | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteBusy, setNoteBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const params = useSearchParams()

  // Deep link from the dashboard checklist (?phone=…) — open that conversation on load.
  useEffect(() => {
    const phone = params.get('phone')
    if (phone) setSelected(phone)
  }, [params])

  const poll = useCallback(async () => {
    try {
      const inbox = await listInboxAction()
      setConvs(inbox.items)
      setPeriod(inbox.period)
    } catch (e) {
      // ESKİ SEKME (owner, 2026-09-16): panel gün içinde güncellendiğinde açık sekme artık var olmayan bir Server
      // Action'ı çağırıyor. Sessizce eski listeyi tutmak, resepsiyona "sohbetler gelmiyor" dedirtiyordu.
      if (isStaleDeployment(e)) {
        toast.message(STALE_DEPLOYMENT_MESSAGE)
        window.setTimeout(() => window.location.reload(), 1200)
        return
      }
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
        const d = await getConversationAction({ key: selected })
        if (alive) setDetail(d)
      } catch (e) {
        if (isStaleDeployment(e)) {
          toast.message(STALE_DEPLOYMENT_MESSAGE)
          window.setTimeout(() => window.location.reload(), 1200)
          return
        }
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

  // NOT, YOKLAMAYA BAĞLANMAZ — bilerek ayrı bir etki. Sohbet detayı beş saniyede bir tazeleniyor;
  // not da onunla gelseydi, masadaki kişi yazarken kutusu her beş saniyede bir üstüne yazılırdı.
  // Not yalnızca sohbet DEĞİŞTİĞİNDE okunur, bir de kaydedildikten sonra.
  useEffect(() => {
    if (!selected) {
      setNote(null)
      setNoteDraft('')
      setNoteOpen(false)
      return
    }
    let alive = true
    setDraftEdit(null)
    void conversationNoteAction({ key: selected })
      .then((n) => {
        if (!alive) return
        setNote(n)
        setNoteDraft(n?.text ?? '')
        setNoteOpen(false)
      })
      .catch(() => {
        /* notu gösterememek sohbeti bozmaz */
      })
    return () => {
      alive = false
    }
  }, [selected])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [detail?.messages.length])

  const filtre = (c: InboxItem) =>
    (channel === 'all' || c.channel === channel) &&
    (filter === 'hot'
      ? c.temp === 'sıcak'
      : filter === 'waiting'
        ? c.needsAttention
        : filter === 'human'
          ? c.status === 'human'
          : filter === 'draft'
            ? c.draft !== null
            : true)
  const draftCount = convs.filter((c) => c.draft !== null).length
  const sections = inboxSections(convs, eski.older, period)
  const shown = sections.flatMap((x) => x.rows).filter(filtre)

  async function send() {
    if (!selected || !text.trim()) return
    setBusy(true)
    try {
      const res = await replyConversationAction({ key: selected, text: text.trim() })
      if (res.ok) {
        setText('')
        setDetail(await getConversationAction({ key: selected }))
      } else toast.error(replyErrorText(res.error.code))
    } catch {
      toast.error('Gönderilemedi.')
    }
    setBusy(false)
  }

  // AI TASLAĞINI GÖNDER (IG-1). Düzenlendiyse düzenlenmiş hali gider. Bu, AI'ın sırasını bir
  // insanın onaylamasıdır — devralma değil: sohbet AI'da kalır ve bir sonraki mesaja yine taslak gelir.
  async function sendDraft() {
    if (!selected || !detail?.draft) return
    const body = (draftEdit ?? detail.draft.text).trim()
    if (!body) return
    setBusy(true)
    try {
      const res = await replyConversationAction({ key: selected, text: body, fromDraft: true })
      if (res.ok) {
        setDraftEdit(null)
        setDetail(await getConversationAction({ key: selected }))
        toast.success('Gönderildi.')
      } else toast.error(replyErrorText(res.error.code))
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Gönderilemedi.')
    }
    setBusy(false)
  }

  async function handOff(status: 'ai' | 'human') {
    if (!selected) return
    const res = await setConversationStatusAction({ key: selected, status }).catch(() => null)
    setDraftEdit(null)
    setDetail((d) => (d ? { ...d, status, draft: status === 'human' ? null : d.draft } : d))
    // Cevapsız bir soru varken işaret kapanmıyor. Sessizce kapanmamasından daha kötü tek şey var:
    // sessizce kapanmaması ve kimsenin sebebini bilmemesi.
    if (res?.stillWaiting) toast.warning('Müşterinin son sorusu hâlâ cevapsız — işaret açık kalıyor. Cevap yazınca kapanır.')
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Sohbetler" description="WhatsApp ve Instagram — AI resepsiyonistin tüm konuşmaları, canlı ve geçmiş." />

      <div className="flex flex-wrap gap-1.5">
        {([['all', 'Hepsi'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setChannel(k)}
            aria-pressed={channel === k}
            className={`min-h-9 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${channel === k ? 'bg-foreground text-background' : 'border border-border bg-card text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([['all', 'Tümü'], ['draft', draftCount > 0 ? `Taslak bekleyen · ${draftCount}` : 'Taslak bekleyen'], ['waiting', 'Bekleyen'], ['hot', 'Sıcak'], ['human', 'İnsan yönetiyor']] as const).map(([k, label]) => (
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
            <InboxSectionList
              sections={sections}
              filter={filtre}
              renderRow={(c) => (
              <li key={c.key}>
                <button type="button" onClick={() => setSelected(c.key)} className={`flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/40 ${selected === c.key ? 'bg-muted/50' : ''}`}>
                  <span className={`mt-1 size-2 shrink-0 rounded-full ${c.temp ? TEMP_DOT[c.temp] : 'bg-muted-foreground/30'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{convLabel(c)}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{mesajZamani(c.lastAt).slice(0, 5)}</span>
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{c.lastText || '—'}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      <ChannelBadge channel={c.channel} />
                      {c.draft ? <span className="inline-block rounded bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">Taslak hazır</span> : null}
                      {c.needsAttention ? <span className="inline-block rounded bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-700">operatör bekliyor</span> : null}
                    </span>
                  </span>
                  {c.status === 'human' ? <UserRoundIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> : <BotIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />}
                </button>
              </li>
              )}
            />
          )}
          {period ? (
            <li>
              <OlderConversationsButton state={eski} />
            </li>
          ) : null}
        </ul>

        {/* thread */}
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-card">
          {!selected || !detail ? (
            <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Bir sohbet seç.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{convLabel(detail)}</span>
                    {detail.handle && detail.name ? <span className="truncate text-xs text-muted-foreground">@{detail.handle}</span> : null}
                    <ChannelBadge channel={detail.channel} />
                  </p>
                  {/* TELEFON, HER ZAMAN GÖRÜNÜR (owner, 2026-10-02: *"sohbetleri gördüm ama telefon
                      numarasını göremedim, ekle lütfen"*).
                      Numara buraya kadar hep geliyordu ama yalnızca AD BOŞSA yazılıyordu — yani adı
                      bilinen herkeste gizliydi. Oysa bu ekranda numaraya en çok ihtiyaç duyulan an,
                      kimin olduğunu bildiğin an: arayacaksın. `tel:` ile veriliyor, böylece okunacak
                      bir metin değil, basılacak bir düğme. */}
                  {detail.phone ? (
                    <a href={`tel:${detail.phone}`} className="text-xs font-medium text-primary hover:underline">
                      {detail.phone}
                    </a>
                  ) : null}
                  {detail.channel === 'instagram' && !detail.phone ? (
                    <p className="text-xs text-muted-foreground">Telefon henüz yok — yazınca Satış Hunisi&apos;ne eklenir.</p>
                  ) : null}
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
              {/* ── KALICI NOT (owner, 2026-10-02) ──────────────────────────────────────────
                  Sohbetin üstünde, mesajların dışında: bu, konuşmanın bir parçası değil, stüdyonun
                  o kişi hakkında kendine yazdığı not. Yazılmamışsa yalnızca bir bağlantı duruyor —
                  boş bir kutu her sohbette göz yorar. */}
              <div className="border-b border-border px-4 py-2">
                {noteOpen ? (
                  <div className="space-y-2">
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={2}
                      maxLength={1000}
                      autoFocus
                      placeholder="Bu kişi hakkında not — ör. “fiyatı yüksek buldu, Ocak’ta tekrar ara”"
                      className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={noteBusy}
                        onClick={async () => {
                          if (!selected) return
                          setNoteBusy(true)
                          try {
                            // Boş metin SİLER — ayrı bir "sil" düğmesi yok: kullanıcının yaptığı şey
                            // zaten tek, kutuyu boşaltıp kaydetmek.
                            await setConversationNoteAction({ key: selected, text: noteDraft.trim() })
                            setNote(await conversationNoteAction({ key: selected }))
                            setNoteOpen(false)
                            toast.success(noteDraft.trim() === '' ? 'Not silindi.' : 'Not kaydedildi.')
                          } catch (e) {
                            toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Not kaydedilemedi.')
                          }
                          setNoteBusy(false)
                        }}
                        className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        Kaydet
                      </button>
                      <button
                        type="button"
                        disabled={noteBusy}
                        onClick={() => {
                          setNoteDraft(note?.text ?? '')
                          setNoteOpen(false)
                        }}
                        className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/40"
                      >
                        Vazgeç
                      </button>
                      {noteDraft.trim() !== '' ? (
                        <span className="text-[11px] text-muted-foreground">Kutuyu boşaltıp kaydedersen not silinir.</span>
                      ) : null}
                    </div>
                  </div>
                ) : note ? (
                  <button type="button" onClick={() => setNoteOpen(true)} className="w-full text-left">
                    <span className="block whitespace-pre-wrap text-xs text-foreground">📌 {note.text}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {note.byName ? `${note.byName} · ` : ''}
                      {mesajZamani(note.at)} · düzenlemek için tıkla
                    </span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setNoteOpen(true)} className="text-xs text-muted-foreground hover:text-foreground">
                    + Not ekle
                  </button>
                )}
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4">
                {detail.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${m.role === 'user' ? 'bg-card text-foreground shadow-sm' : 'bg-emerald-600 text-white'}`}>
                      {m.text}
                      <div className={`mt-0.5 text-[10px] ${m.role === 'user' ? 'text-muted-foreground' : 'text-white/70'}`}>{mesajZamani(m.at).slice(-5)}</div>
                    </div>
                  </div>
                ))}
                {detail.draft ? (
                  // ── AI TASLAĞI (IG-1, onaylı tasarım) ─────────────────────────────────────
                  // Kesik çizgili balon: henüz kimseye gitmedi. Gönder en büyük düğme ve başparmak
                  // hizasında; pencere dolduysa pasif ve yerine "Ara" (telefon biliniyorsa).
                  <div className="ml-auto flex w-full max-w-[88%] flex-col gap-2 sm:max-w-[62%]">
                    <div className="rounded-2xl rounded-br-sm border-[1.5px] border-dashed border-primary bg-card px-3 py-2.5">
                      <p className="text-[11px] font-semibold tracking-wide text-primary uppercase">
                        {detail.replyWindowOpen ? 'AI taslağı · henüz gönderilmedi' : 'AI taslağı · gönderilemez'}
                      </p>
                      {draftEdit !== null ? (
                        <textarea
                          value={draftEdit}
                          onChange={(e) => setDraftEdit(e.target.value)}
                          rows={4}
                          maxLength={4000}
                          autoFocus
                          aria-label="Taslağı düzenle"
                          className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      ) : (
                        <p className={`mt-1 text-sm whitespace-pre-wrap ${detail.replyWindowOpen ? 'text-foreground' : 'text-muted-foreground'}`}>{detail.draft.text}</p>
                      )}
                    </div>
                    {detail.replyWindowOpen ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void sendDraft()}
                          disabled={busy || (draftEdit !== null && draftEdit.trim() === '')}
                          className="col-span-2 min-h-12 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          {draftEdit !== null ? 'Düzenlenmiş hali gönder' : 'Gönder'}
                        </button>
                        {draftEdit !== null ? (
                          <button type="button" onClick={() => setDraftEdit(null)} className="col-span-2 min-h-11 rounded-xl border border-border bg-card text-sm font-medium text-foreground">
                            Düzenlemeyi bırak
                          </button>
                        ) : (
                          <button type="button" onClick={() => setDraftEdit(detail.draft?.text ?? '')} className="col-span-2 min-h-11 rounded-xl border border-border bg-card text-sm font-medium text-foreground">
                            Düzenle
                          </button>
                        )}
                        <button type="button" onClick={() => void handOff('human')} className="col-span-2 min-h-10 text-sm font-medium text-muted-foreground underline">
                          Ben cevaplayacağım
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs text-foreground">
                          Instagram 24 saatlik cevap penceresi doldu.{' '}
                          {detail.phone ? 'Telefonu biliniyor: arayın ya da WhatsApp’tan yazın.' : 'Müşteri tekrar yazınca cevap verilebilir.'}
                        </p>
                        {detail.phone ? (
                          <a href={`tel:+${detail.phone.replace(/\D/g, '')}`} className="ml-auto flex min-h-11 w-fit items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
                            Ara
                          </a>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
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
