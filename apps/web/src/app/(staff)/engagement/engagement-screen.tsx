'use client'

import { useMemo, useState } from 'react'
import { BellRingIcon, Loader2Icon, PencilIcon, PlusIcon, SendIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { saveErrorMessage } from '@/lib/stale-deployment'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  deleteEngagementContentAction,
  engagementSuggestionsAction,
  listEngagementContentAction,
  seedEngagementContentAction,
  upsertEngagementContentAction,
  type EngagementCategory,
  type EngagementContent,
  type EngagementSuggestion,
  type SegmentInfo,
} from '@/server/actions/engagement'
import {
  cancelEngagementRunAction,
  engagementRunAction,
  previewEngagementAction,
  sendEngagementAction,
  sendSuggestionsAction,
  type EngagementRun,
} from '@/server/actions/notifications'

import { AudiencePanel, type Audience } from './audience-panel'
import { ChannelPicker, type Sendable } from './channel-picker'
import { SendPreviewDialog, type EngagementPreview } from './send-preview-dialog'

const CAT_LABEL: Record<EngagementCategory, string> = {
  motivation: 'Motivasyon',
  birthday: 'Doğum günü',
  missed: 'Seni özledik',
  welcome: 'Hoş geldin',
  cancellation: 'İptal',
  milestone: 'Kilometre taşı',
  campaign: 'Kampanya',
  custom: 'Diğer',
}
const CATS = Object.keys(CAT_LABEL) as EngagementCategory[]
const KANAL_ADI: Record<string, string> = { whatsapp: 'WhatsApp', email: 'E-posta', push: 'Push' }
const EMPTY = { id: '', category: 'motivation' as EngagementCategory, title: '', subject: '', body: '', updatedAt: 0 }

export function EngagementScreen({
  initialContent,
  segments,
  initialSuggestions,
  canManage,
}: {
  initialContent: EngagementContent[]
  segments: SegmentInfo[]
  initialSuggestions: EngagementSuggestion[]
  canManage: boolean
}) {
  const [content, setContent] = useState<EngagementContent[]>(initialContent)
  const reloadContent = async () => setContent([...(await listEngagementContentAction())])

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-10">
      <div>
        <h1 className="text-display font-semibold">Stüdyodan</h1>
        <p className="text-sm text-muted-foreground">Üyelerinle bağ kur — motivasyon, kutlama ve kampanyaları doğru kitleye gönder. Her gönderim senin onayınla.</p>
      </div>

      <Tabs defaultValue={canManage && initialSuggestions.length > 0 ? 'suggestions' : 'send'}>
        <TabsList>
          {canManage ? (
            <TabsTrigger value="suggestions">
              <BellRingIcon className="size-4" /> Öneriler{initialSuggestions.length > 0 ? ` (${initialSuggestions.length})` : ''}
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="send"><SendIcon className="size-4" /> Bildirim Gönder</TabsTrigger>
          <TabsTrigger value="library"><SparklesIcon className="size-4" /> Hazır Metinler</TabsTrigger>
        </TabsList>

        {canManage ? (
          <TabsContent value="suggestions">
            <Suggestions initial={initialSuggestions} />
          </TabsContent>
        ) : null}

        <TabsContent value="send">
          <Composer content={content} segments={segments} canManage={canManage} />
        </TabsContent>

        <TabsContent value="library">
          <Library content={content} canManage={canManage} onChanged={reloadContent} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Öneriler ──────────────────────────────────────────────────────────────────────────────────
function Suggestions({ initial }: { initial: EngagementSuggestion[] }) {
  const [items, setItems] = useState<EngagementSuggestion[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)

  async function send(list: EngagementSuggestion[], key: string) {
    setBusy(key)
    try {
      const res = await sendSuggestionsAction({ items: list.map((s) => ({ memberId: s.memberId, subject: s.subject, body: s.body, logKey: s.logKey })) })
      if (res.ok) {
        const ids = new Set(list.map((s) => s.id))
        setItems((prev) => prev.filter((s) => !ids.has(s.id)))
        toast.success(`${res.value.sent} mesaj gönderildi.`)
        setItems([...(await engagementSuggestionsAction())])
      } else toast.error('Gönderilemedi.')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const edit = (id: string, patch: Partial<EngagementSuggestion>) => setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center">
        <BellRingIcon className="mx-auto size-8 text-accent" />
        <p className="mt-3 font-medium">Bugün için öneri yok</p>
        <p className="mt-1 text-sm text-muted-foreground">Doğum günleri, soğuyan üyeler ve kilometre taşları burada belirir — hepsi senin onayınla gider.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{items.length} öneri — her biri düzenlenebilir, gönderim senin onayınla.</p>
        <Button size="sm" onClick={() => void send(items, 'all')} disabled={!!busy}>
          {busy === 'all' ? <Loader2Icon className="animate-spin" /> : <SendIcon className="size-4" />} Hepsini gönder
        </Button>
      </div>
      {items.map((s) => (
        <div key={s.id} className="space-y-2 rounded-xl border bg-card p-3.5 shadow-xs">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-accent">{s.typeLabel}</span>
            <span className="font-semibold">{s.memberName}</span>
            <span className="text-muted-foreground">· {s.reason}</span>
          </div>
          <Input value={s.subject} onChange={(e) => edit(s.id, { subject: e.target.value })} className="text-sm font-medium" />
          <Textarea value={s.body} onChange={(e) => edit(s.id, { body: e.target.value })} rows={2} className="text-sm" />
          <Button size="sm" variant="outline" onClick={() => void send([s], s.id)} disabled={!!busy}>
            {busy === s.id ? <Loader2Icon className="animate-spin" /> : <SendIcon className="size-4" />} Gönder
          </Button>
        </div>
      ))}
    </div>
  )
}

// ── Composer ──────────────────────────────────────────────────────────────────────────────────
function Composer({ content, segments, canManage }: { content: EngagementContent[]; segments: SegmentInfo[]; canManage: boolean }) {
  const [audience, setAudience] = useState<Audience>({ kind: 'segment', key: 'all' })
  const [preview, setPreview] = useState<EngagementPreview | null>(null)
  const [audienceLabel, setAudienceLabel] = useState('')
  const [checking, setChecking] = useState(false)
  // Live progress of the running send. The send itself is a single long request, so the ONLY way to
  // see inside it is to ask the server separately — which is also what makes it stoppable.
  const [run, setRun] = useState<EngagementRun | null>(null)
  const [hepsiMetin, setHepsiMetin] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null)
  // Hangi kanallardan gidecek. BOŞ artık "stüdyo ayarı" değil, "yalnızca uygulama içi" demek
  // (owner, 2026-08-31) — ve bu ayrım sunucuya da açıkça taşınıyor: `in_app` her zaman listeye
  // eklenerek gönderiliyor, böylece dizi hiç boş kalmıyor ve "belirtilmedi" ile "hiçbiri"
  // birbirine karışmıyor. Varsayılan WhatsApp: stüdyonun bugüne kadarki davranışı bu.
  const [channels, setChannels] = useState<Sendable[]>(['whatsapp'])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const pick = (c: EngagementContent) => {
    setSubject(c.subject)
    setBody(c.body)
  }

  /** The audience, as the actions want it. One place, so preview and send cannot disagree. */
  const audienceInput = audience.kind === 'segment' ? { segment: audience.key } : { groupId: audience.id }

  // "Gönder" no longer sends. It ASKS the server who would receive what, and shows it. The send is a
  // second, deliberate press — because 173 messages cannot be taken back and a confirm() repeating a
  // number the owner already saw was never a check.
  async function check() {
    if (!subject.trim() || !body.trim()) {
      toast.error('Başlık ve mesaj zorunlu.')
      return
    }
    setChecking(true)
    try {
      const res = await previewEngagementAction({ ...audienceInput, channels: ['in_app', ...channels] })
      if (!res.ok) {
        toast.error('Önizleme alınamadı.')
        return
      }
      if (res.value.total === 0) {
        toast.error('Seçilen kitlede üye yok.')
        return
      }
      setPreview(res.value)
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  async function send() {
    setSending(true)
    // Poll while it runs. Started BEFORE the await, because the send does not return until it is
    // finished and by then there is nothing left to watch.
    const timer = setInterval(() => {
      void engagementRunAction()
        .then((r) => setRun(r))
        .catch(() => undefined)
    }, 1500)
    try {
      const res = await sendEngagementAction({
        subject: subject.trim(),
        body: body.trim(),
        ...audienceInput,
        channels: ['in_app', ...channels],
      })
      if (res.ok) {
        // "Durduruldu" alone invites the question it must answer: durduruldu, ama kaça gitti?
        toast.success(
          res.value.stopped
            ? `Gönderim durduruldu — ${res.value.sent} üyeye gitti, ${res.value.total - res.value.sent - res.value.failed} kişiye gönderilmedi.`
            : `${res.value.sent} üyeye gönderildi${res.value.failed ? `, ${res.value.failed} başarısız` : ''}.`,
        )
        // Kept on screen, not only in a toast. A toast for a 158-person send is gone in four seconds
        // and the one number worth remembering — how many failed — goes with it.
        setResult({ sent: res.value.sent, failed: res.value.failed, total: res.value.total })
        setPreview(null)
        setSubject('')
        setBody('')
      } else toast.error('Gönderilemedi.')
    } catch (e) {
      // A tab left open across a deployment cannot send, and "Gönderilemedi" invites the one thing
      // that cannot work — pressing it again. The logs showed exactly that: eight attempts, four
      // seconds apart, none of which ever reached the server.
      toast.error(saveErrorMessage(e))
    } finally {
      clearInterval(timer)
      setRun(null)
      setSending(false)
    }
  }

  async function stop() {
    if (!run) return
    try {
      const res = await cancelEngagementRunAction({ operationId: run.operationId })
      if (res.ok) {
        // Deliberately not "durduruldu": the loop stops at its next check, and the messages already
        // in flight are gone. Saying it is done before it is done is the lie this screen exists to
        // stop telling.
        toast.info('Durdurma isteği gönderildi — bir sonraki adımda duracak.')
        setRun({ ...run, status: 'cancelling' })
      } else toast.error('Gönderim durdurulamadı.')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    }
  }

  // Seçili kitledeki kişi sayısı — kanal satırlarının "kaçına ulaşamıyoruz"u için.
  const audienceTotal =
    audience.kind === 'segment' ? (segments.find((x) => x.key === audience.key)?.count ?? 0) : 0

  /** Bir adımın kabuğu. Numara süs değil: kitleyi seçmeden kaç kişiye ulaşılacağı hesaplanamaz. */
  const Adim = ({ n, baslik, ipucu, children }: { n: number; baslik: string; ipucu?: string; children: React.ReactNode }) => (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-bold text-primary">
          {n}
        </span>
        <span className="text-[15px] font-semibold text-foreground">{baslik}</span>
        {ipucu ? <span className="ml-auto hidden text-xs text-muted-foreground sm:block">{ipucu}</span> : null}
      </div>
      {children}
    </section>
  )

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_336px]">
      <div className="space-y-4">
        <Adim n={1} baslik="Kime gidecek?" ipucu="Sayıya tıkla → kimler olduğunu gör">
          <AudiencePanel
            segments={segments}
            audience={audience}
            onAudience={setAudience}
            onLabel={setAudienceLabel}
            canManage={canManage}
          />
        </Adim>

        <Adim n={2} baslik="Ne yazacaksın?" ipucu="Hazır metni seç, üstünde değiştir">
          {content.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {(hepsiMetin ? content : content.slice(0, 6)).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c)}
                  className="rounded-lg border bg-surface px-3 py-1.5 text-left text-sm shadow-xs transition-colors hover:border-primary"
                >
                  <span className="text-xs text-muted-foreground">{CAT_LABEL[c.category]}</span>
                  <span className="block font-medium">{c.title}</span>
                </button>
              ))}
              {/* 16 hazır metin ekranı boğuyordu. Kaybolmadılar — hepsi aynı anda bağırmıyor. */}
              {content.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setHepsiMetin((v) => !v)}
                  className="self-center rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {hepsiMetin ? 'Daha az göster' : `Tüm hazır metinler (${content.length}) →`}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Başlık</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Yeni bir hafta, yeni bir sen ✨" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mesaj</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={600} placeholder="Üyene söylemek istediğin sıcak mesaj…" />
          </div>
        </Adim>

        <Adim n={3} baslik="Nereden gitsin?" ipucu="Kaç kişiye ulaşacağı yanında yazıyor">
          <ChannelPicker audience={audience} total={audienceTotal} selected={channels} onChange={setChannels} />
        </Adim>
      </div>

      {/* ── ÖZET. "Ne yapmak üzereyim?" sorusunun cevabı, ekranı kaydırınca kaybolmasın diye
          yapışkan. Gönder düğmesi de burada — karar ile eylem aynı yerde. ── */}
      <aside className="space-y-3 lg:sticky lg:top-4">
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Bu gönderim</p>

          <div className="rounded-r-lg border-l-[3px] border-primary bg-muted/50 p-3">
            <p className="text-sm font-semibold">📣 {subject.trim() || 'Başlık'}</p>
            <p className="line-clamp-3 text-sm text-muted-foreground">{body.trim() || 'Mesaj burada görünecek.'}</p>
          </div>

          <dl className="text-sm">
            <div className="flex justify-between gap-3 border-b border-border py-1.5">
              <dt className="text-muted-foreground">Kitle</dt>
              <dd className="text-right font-medium">{audienceLabel || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">Kanallar</dt>
              <dd className="text-right font-medium">
                {['Uygulama içi', ...channels.map((c) => KANAL_ADI[c])].join(' · ')}
              </dd>
            </div>
          </dl>

          <Button className="w-full" onClick={() => void check()} disabled={checking || sending}>
            {checking ? <Loader2Icon className="animate-spin" /> : <SendIcon className="size-4" />}
            {checking ? 'Hesaplanıyor…' : 'Kimlere gideceğini gör'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Onaylamadan hiçbir mesaj gitmez</p>

          {/* Meta konuşma başına ücret alıyor. Kapatma seçeneğinin orada olduğunu hatırlatmak,
              faturayı ay sonunda açıklamaktan ucuz. */}
          {channels.includes('whatsapp') ? (
            <div className="flex gap-2 rounded-lg bg-warning/10 p-2.5 text-xs leading-snug text-foreground">
              <span aria-hidden>💬</span>
              <span>
                WhatsApp seçili — <b>ücretli mesaj</b> gider. Yalnızca uygulamaya düşürmek için WhatsApp'ı kapat.
              </span>
            </div>
          ) : null}
        </div>
      </aside>

      {preview ? (
        <SendPreviewDialog
          preview={preview}
          audienceLabel={audienceLabel}
          subject={subject.trim()}
          body={body.trim()}
          sending={sending}
          run={run}
          onConfirm={() => void send()}
          onStop={() => void stop()}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {sending ? (
        <p className="text-xs text-muted-foreground">
          Üyeler tek tek işleniyor; kitle büyükse bir dakikayı bulabilir. Sayfayı kapatma.
        </p>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-border p-3 text-sm">
          <b>{result.sent} üyeye gönderildi.</b>
          {result.failed > 0 ? (
            <span className="text-muted-foreground">
              {' '}
              {result.failed} gönderim başarısız — bildirim kayıtlarından sebebine bakılabilir.
            </span>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">Uygulama içi "Stüdyodan" akışına her zaman düşer; bildirimi açık üyelere ayrıca telefon bildirimi gider.</p>
    </div>
  )
}

// ── İçerik Kütüphanesi ────────────────────────────────────────────────────────────────────────
function Library({ content, canManage, onChanged }: { content: EngagementContent[]; canManage: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<EngagementContent | null>(null)
  const [busy, setBusy] = useState(false)
  const grouped = useMemo(() => CATS.map((c) => ({ cat: c, items: content.filter((x) => x.category === c) })).filter((g) => g.items.length > 0), [content])

  async function seed() {
    setBusy(true)
    try {
      const r = await seedEngagementContentAction()
      if (r.ok) {
        await onChanged()
        toast.success(`${r.value.count} hazır içerik eklendi.`)
      } else toast.error('Zaten içerik var.')
    } catch {
      toast.error('Yüklenemedi.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!editing) return
    if (!editing.title.trim() || !editing.subject.trim() || !editing.body.trim()) {
      toast.error('Tüm alanlar zorunlu.')
      return
    }
    setBusy(true)
    try {
      const r = await upsertEngagementContentAction({ id: editing.id || undefined, category: editing.category, title: editing.title.trim(), subject: editing.subject.trim(), body: editing.body.trim() })
      if (r.ok) {
        await onChanged()
        setEditing(null)
        toast.success('Kaydedildi.')
      }
    } catch {
      toast.error('Kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: EngagementContent) {
    if (!confirm(`"${c.title}" silinsin mi?`)) return
    setBusy(true)
    try {
      await deleteEngagementContentAction({ id: c.id })
      await onChanged()
      toast.success('Silindi.')
    } catch {
      toast.error('Silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}><PlusIcon className="size-4" /> Yeni İçerik</Button>
          {content.length === 0 ? <Button size="sm" variant="outline" onClick={() => void seed()} disabled={busy}><SparklesIcon className="size-4" /> Hazır içerikleri yükle</Button> : null}
        </div>
      ) : null}

      {content.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Henüz içerik yok.</p>
      ) : (
        grouped.map((g) => (
          <section key={g.cat} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{CAT_LABEL[g.cat]}</h3>
            <ul className="space-y-2">
              {g.items.map((c) => (
                <li key={c.id} className="rounded-xl border bg-card p-3 shadow-xs">
                  <p className="font-medium">{c.title}</p>
                  <p className="text-sm font-semibold text-foreground">{c.subject}</p>
                  <p className="text-sm text-muted-foreground">{c.body}</p>
                  {canManage ? (
                    <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                      <button type="button" onClick={() => setEditing({ ...c })} className="inline-flex items-center gap-1 hover:text-foreground"><PencilIcon className="size-3" /> Düzenle</button>
                      <button type="button" onClick={() => void remove(c)} className="inline-flex items-center gap-1 hover:text-danger"><Trash2Icon className="size-3" /> Sil</button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-5 sm:max-w-lg">
          {editing ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle className="text-h1">{editing.id ? 'İçeriği Düzenle' : 'Yeni İçerik'}</SheetTitle>
                <SheetDescription>Kütüphanedeki bu içeriği Gönder ekranından seçip yollarsın.</SheetDescription>
              </SheetHeader>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Kategori</label>
                <div className="flex flex-wrap gap-2">
                  {CATS.map((c) => (
                    <button key={c} type="button" onClick={() => setEditing({ ...editing, category: c })} className={`rounded-full px-3 py-1.5 text-sm font-medium ${editing.category === c ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>{CAT_LABEL[c]}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5"><label className="text-sm font-medium">İç başlık <span className="font-normal text-muted-foreground">(sadece sen görürsün)</span></label><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Pazartesi motivasyonu" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Başlık <span className="font-normal text-muted-foreground">(üye görür)</span></label><Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} maxLength={120} /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Mesaj</label><Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={6} maxLength={600} /></div>
              <div className="flex gap-2">
                <Button onClick={() => void save()} disabled={busy}>{busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet</Button>
                <Button variant="outline" onClick={() => setEditing(null)}>Vazgeç</Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
