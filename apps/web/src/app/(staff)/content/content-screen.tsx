'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, PlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import { domainErrorMessage } from '@/lib/domain-error'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import {
  addContentIdeaAction,
  approveContentPostAction,
  contentWeekAction,
  editContentPostAction,
  removeContentPostAction,
  setContentAreasAction,
  suggestContentWeekAction,
  type ContentResult,
  type ContentWeek,
} from '@/server/actions/content'

import { EditPanel } from './edit-panel'
import { MusicLibraryPanel } from './music-library'
import { PublishPanel } from './publish-panel'

// IG-2a — the week's Instagram plan (onaylı tasarım: https://claude.ai/artifact/Lu36nxmwhCoUogRoAnojeU).
// Mobile first: on a phone the list and the card are two screens; from md up, side by side.

type Post = ContentWeek['posts'][number]
type Format = Post['format']
interface Draft {
  readonly id: string | null // null = the studio's own new idea
  date: string // 'YYYY-MM-DD' (Istanbul)
  time: string // 'HH:MM'
  format: Format
  title: string
  clips: { seconds: number; angle: string; what: string }[]
  hook: string
  notes: string
  music: string
  caption: string
  hashtags: string
}

const IST = 3 * 3_600_000
const FORMAT_LABEL: Record<Format, string> = { reels: 'Reels', photo: 'Fotoğraf', story: 'Hikâye' }
const FORMAT_CHIP: Record<Format, string> = {
  reels: 'bg-info/15 text-info',
  photo: 'bg-success/15 text-success',
  story: 'bg-warning/15 text-warning',
}
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

const istParts = (t: number) => {
  const d = new Date(t + IST)
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), dow: (d.getUTCDay() + 6) % 7, day: d.getUTCDate() }
}
const fromIst = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`) - IST
const shiftWeek = (w: string, n: number) => {
  const d = new Date(`${w}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 7 * n)
  return d.toISOString().slice(0, 10)
}
const weekLabel = (w: string) => {
  const a = new Date(`${w}T00:00:00Z`)
  const b = new Date(a.getTime() + 6 * 86_400_000)
  return `${a.getUTCDate()}–${b.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
}

function statusLine(p: Post): { text: string; cls: string } {
  if (p.status === 'published') return { text: 'Yayında', cls: 'text-success' }
  if (p.status === 'publishing') return { text: 'Instagram’a gönderiliyor…', cls: 'text-info' }
  if (p.status === 'scheduled') return { text: 'Yayına hazır · saatinde çıkar', cls: 'text-info' }
  if (p.status === 'failed') return { text: 'Yayınlanamadı · bakın', cls: 'text-destructive' }
  if (p.media) return { text: 'Dosya yüklendi · sahibin onayını bekliyor', cls: 'text-warning' }
  if (p.status === 'approved') return { text: 'Plan onaylı · çekim bekliyor', cls: 'text-success' }
  return p.origin === 'ai' ? { text: 'Öneri · gözden geçirilmedi', cls: 'text-muted-foreground' } : { text: 'Ekibin fikri · onay bekliyor', cls: 'text-warning' }
}

function toDraft(p: Post | null, weekStart: string): Draft {
  if (!p) {
    return { id: null, date: weekStart, time: '19:00', format: 'reels', title: '', clips: [{ seconds: 3, angle: '', what: '' }], hook: '', notes: 'Telefon dik (9:16).', music: '', caption: '', hashtags: '' }
  }
  const { date, time } = istParts(p.scheduledFor)
  return {
    id: p.id,
    date,
    time,
    format: p.format,
    title: p.title,
    clips: p.shotCard.clips.map((c) => ({ ...c })),
    hook: p.shotCard.hook,
    notes: p.shotCard.notes,
    music: p.shotCard.music,
    caption: p.caption,
    hashtags: p.hashtags.map((h) => `#${h}`).join(' '),
  }
}

function explain(r: ContentResult<unknown>): string {
  if (r.ok) return ''
  return r.error.code === 'ai_unavailable' ? 'AI şu an öneri hazırlayamadı. Biraz sonra tekrar deneyin.' : domainErrorMessage(r.error)
}

export function ContentScreen() {
  const [week, setWeek] = useState<ContentWeek | null>(null)
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [areasOpen, setAreasOpen] = useState(false)
  const [musicOpen, setMusicOpen] = useState(false)
  const [areasText, setAreasText] = useState('')

  const load = useCallback(async (w?: string) => {
    try {
      const data = await contentWeekAction({ weekStart: w })
      setWeek(data)
      setWeekStart(data.weekStart)
      setAreasText(data.areas.join(', '))
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Plan yüklenemedi.')
    }
  }, [])
  useEffect(() => void load(), [load])

  const posts = useMemo(() => week?.posts ?? [], [week])
  const current = posts.find((p) => p.id === selected) ?? null
  const approved = posts.filter((p) => p.status !== 'suggested').length

  async function run<T>(key: string, f: () => Promise<ContentResult<T>>, okMsg: string): Promise<boolean> {
    setBusy(key)
    try {
      const r = await f()
      if (!r.ok) {
        toast.error(explain(r))
        return false
      }
      toast.success(okMsg)
      await load(weekStart)
      return true
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'İşlem tamamlanamadı.')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function suggest() {
    if (!weekStart) return
    await run('suggest', () => suggestContentWeekAction({ weekStart }), 'Öneriler hazır.')
  }

  async function saveDraft() {
    if (!draft) return
    const fields = {
      scheduledFor: fromIst(draft.date, draft.time),
      format: draft.format,
      title: draft.title,
      shotCard: { clips: draft.clips, hook: draft.hook, notes: draft.notes, music: draft.music },
      caption: draft.caption,
      hashtags: draft.hashtags.split(/[\s,]+/).filter(Boolean),
    }
    const ok = await run(
      'save',
      () => (draft.id ? editContentPostAction({ id: draft.id, fields }) : addContentIdeaAction({ fields })),
      draft.id ? 'Kaydedildi.' : 'Fikir plana eklendi.',
    )
    if (ok) setDraft(null)
  }

  async function approve() {
    if (!current) return
    const ok = await run('approve', () => approveContentPostAction({ id: current.id, consentConfirmed: consent }), 'Onaylandı.')
    if (ok) setConsent(false)
  }

  async function remove() {
    if (!current) return
    const ok = await run('remove', () => removeContentPostAction({ id: current.id }), 'Plandan çıkarıldı.')
    if (ok) setSelected(null)
  }

  async function saveAreas() {
    setBusy('areas')
    try {
      await setContentAreasAction({ areas: areasText.split(',').map((s) => s.trim()).filter(Boolean) })
      toast.success('Bölge listesi kaydedildi.')
      setAreasOpen(false)
      await load(weekStart)
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setBusy(null)
  }

  if (!week) {
    return (
      <main className="grid min-h-[50vh] place-items-center p-6 text-sm text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </main>
    )
  }

  const detailOpen = Boolean(current || draft)

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="İçerik" description={`Bu haftanın planı · ${weekLabel(week.weekStart)} — AI önerir, siz çekersiniz, sahibi onaylar. Onaysız hiçbir şey paylaşılmaz.`} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void load(shiftWeek(week.weekStart, -1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm" aria-label="Önceki hafta">
          <ChevronLeftIcon className="size-4" /> Önceki
        </button>
        <button type="button" onClick={() => void load(shiftWeek(week.weekStart, 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm" aria-label="Sonraki hafta">
          Sonraki <ChevronRightIcon className="size-4" />
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void suggest()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium disabled:opacity-50">
            {busy === 'suggest' ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
            {posts.some((p) => p.origin === 'ai') ? 'Yeniden öner' : 'Bu haftanın planını öner'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(null)
              setDraft(toDraft(null, week.weekStart))
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-semibold text-background"
          >
            <PlusIcon className="size-4" /> Kendi fikrim
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-40 flex-1 space-y-1.5">
          <p className="text-sm font-semibold">
            {posts.length} gönderi · {approved} onaylandı
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-1.5 bg-primary" style={{ width: `${posts.length ? (approved / posts.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Bölge: {week.areas.length ? week.areas.join(', ') : 'tanımlı değil'}
          {week.canApprove ? (
            <>
              <button type="button" onClick={() => setAreasOpen((v) => !v)} className="ml-2 font-medium text-primary hover:underline">
                Düzenle
              </button>
              <button type="button" onClick={() => setMusicOpen((v) => !v)} className="ml-3 font-medium text-primary hover:underline">
                Müzik
              </button>
            </>
          ) : null}
        </div>
        {musicOpen && week.canApprove ? <MusicLibraryPanel studioId={week.studioId} /> : null}
        {areasOpen ? (
          <div className="flex w-full flex-wrap gap-2">
            <label className="sr-only" htmlFor="areas">Bölge semtleri</label>
            <input id="areas" value={areasText} onChange={(e) => setAreasText(e.target.value)} placeholder="Çayırova, Gebze, …" className="min-h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
            <button type="button" disabled={busy === 'areas'} onClick={() => void saveAreas()} className="min-h-10 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              Kaydet
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <ul className={`space-y-2.5 ${detailOpen ? 'hidden md:block' : ''}`}>
          {posts.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Bu hafta için plan yok. “Bu haftanın planını öner”e basın ya da kendi fikrinizi ekleyin.
            </li>
          ) : (
            posts.map((p) => {
              const t = istParts(p.scheduledFor)
              const st = statusLine(p)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null)
                      setConsent(false)
                      setSelected(p.id)
                    }}
                    className={`flex w-full gap-3 rounded-xl border bg-card p-3.5 text-left ${selected === p.id ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
                  >
                    <span className="flex w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-muted py-1.5">
                      <span className="text-[11px] font-semibold">{DAYS[t.dow]}</span>
                      <span className="text-lg font-bold">{t.day}</span>
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`rounded px-1.5 text-[11px] font-semibold ${FORMAT_CHIP[p.format]}`}>{FORMAT_LABEL[p.format]}</span>
                        <span className="text-xs text-muted-foreground">{t.time}</span>
                      </span>
                      <span className="block text-[15px] font-semibold">{p.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.shotCard.clips.length} klip · ~{p.shotCard.clips.reduce((a, c) => a + c.seconds, 0)} sn
                      </span>
                      <span className={`block text-[11px] font-semibold ${st.cls}`}>{st.text}</span>
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>

        {detailOpen ? (
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <button
              type="button"
              onClick={() => {
                setSelected(null)
                setDraft(null)
              }}
              className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground md:hidden"
            >
              <ChevronLeftIcon className="size-4" /> Plana dön
            </button>

            {draft ? (
              <DraftForm draft={draft} setDraft={setDraft} busy={busy === 'save'} onSave={() => void saveDraft()} onCancel={() => setDraft(null)} />
            ) : current ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {DAYS[istParts(current.scheduledFor).dow]} {istParts(current.scheduledFor).day} · {istParts(current.scheduledFor).time} · {FORMAT_LABEL[current.format]}
                  </p>
                  <h2 className="text-lg font-bold">{current.title}</h2>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-bold">Çekim kartı</h3>
                  {current.shotCard.notes ? <p className="text-sm text-muted-foreground">{current.shotCard.notes}</p> : null}
                  <ol className="space-y-2">
                    {current.shotCard.clips.map((c, i) => (
                      <li key={i} className="flex gap-2.5 text-sm">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                        <span>
                          <b>
                            {c.seconds} sn{c.angle ? ` · ${c.angle}` : ''}:
                          </b>{' '}
                          {c.what}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {current.shotCard.hook ? (
                    <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm">
                      <b>İlk 3 sn yazısı:</b> “{current.shotCard.hook}”
                    </p>
                  ) : null}
                  {current.shotCard.music ? <p className="text-xs text-muted-foreground">Müzik: {current.shotCard.music}</p> : null}
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold">Açıklama</h3>
                  <p className="whitespace-pre-wrap text-sm">{current.caption || '—'}</p>
                  <p className="text-xs text-muted-foreground">{current.hashtags.map((h) => `#${h}`).join(' ')}</p>
                </div>

                <EditPanel post={current} studioId={week.studioId} reload={() => load(weekStart)} />

                <PublishPanel post={current} studioId={week.studioId} canApprove={week.canApprove} reload={() => load(weekStart)} />

                {current.status === 'suggested' && !current.media && week.canApprove ? (
                  <label className="flex min-h-11 items-start gap-2.5 rounded-lg border border-border p-3 text-sm">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-primary" />
                    <span>Videoda/fotoğrafta görünen herkes paylaşıma izin verdi (yüz görünmüyorsa da işaretleyin).</span>
                  </label>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  {current.media || ['scheduled', 'publishing', 'published', 'failed'].includes(current.status) ? null : current.status !== 'approved' ? (
                    week.canApprove ? (
                      <button type="button" disabled={busy !== null || !consent} onClick={() => void approve()} className="col-span-2 min-h-12 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50">
                        Onayla
                      </button>
                    ) : (
                      <p className="col-span-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Onayı stüdyo sahibi verir.</p>
                    )
                  ) : (
                    <p className="col-span-2 rounded-lg bg-success/15 px-3 py-2 text-sm text-foreground">Plan onaylı. Çekip dosyayı yükleyin; yayına son onay ayrıca verilir.</p>
                  )}
                  {current.status === 'publishing' || current.status === 'published' ? null : (
                    <>
                      <button type="button" onClick={() => setDraft(toDraft(current, week.weekStart))} className="min-h-11 rounded-xl border border-border bg-card text-sm font-medium">
                        Düzenle
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => void remove()} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-destructive disabled:opacity-50">
                        <Trash2Icon className="size-4" /> Plandan çıkar
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  )
}

function DraftForm(props: { draft: Draft; setDraft: (d: Draft) => void; busy: boolean; onSave: () => void; onCancel: () => void }) {
  const { draft: d, setDraft } = props
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch })
  const input = 'min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm'
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">{d.id ? 'Gönderiyi düzenle' : 'Kendi fikrin'}</h2>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Başlık</span>
        <input value={d.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} className={input} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Gün</span>
          <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} className={input} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Saat</span>
          <input type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} className={input} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Tür</span>
          <select value={d.format} onChange={(e) => set({ format: e.target.value as Format })} className={input}>
            <option value="reels">Reels</option>
            <option value="photo">Fotoğraf</option>
            <option value="story">Hikâye</option>
          </select>
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Çekim kartı — klipler</legend>
        {d.clips.map((c, i) => (
          <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.75rem] gap-2">
            <input type="number" min={1} max={60} aria-label={`${i + 1}. klip saniye`} value={c.seconds} onChange={(e) => set({ clips: d.clips.map((x, j) => (j === i ? { ...x, seconds: Number(e.target.value) } : x)) })} className={input} />
            <div className="space-y-1">
              <input aria-label={`${i + 1}. klip açı`} placeholder="Açı (yakın, yan, geniş)" value={c.angle} onChange={(e) => set({ clips: d.clips.map((x, j) => (j === i ? { ...x, angle: e.target.value } : x)) })} className={input} />
              <input aria-label={`${i + 1}. klip kadraj`} placeholder="Kadrajda ne var" value={c.what} onChange={(e) => set({ clips: d.clips.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)) })} className={input} />
            </div>
            <button type="button" aria-label={`${i + 1}. klibi sil`} disabled={d.clips.length <= 1} onClick={() => set({ clips: d.clips.filter((_, j) => j !== i) })} className="grid min-h-10 place-items-center rounded-lg border border-border disabled:opacity-40">
              <Trash2Icon className="size-4" />
            </button>
          </div>
        ))}
        <button type="button" disabled={d.clips.length >= 8} onClick={() => set({ clips: [...d.clips, { seconds: 3, angle: '', what: '' }] })} className="min-h-10 text-sm font-medium text-primary disabled:opacity-40">
          + Klip ekle
        </button>
      </fieldset>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">İlk 3 saniye yazısı</span>
        <input value={d.hook} maxLength={120} onChange={(e) => set({ hook: e.target.value })} className={input} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Çekim notu</span>
        <input value={d.notes} onChange={(e) => set({ notes: e.target.value })} className={input} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Müzik (telifsiz)</span>
        <input value={d.music} placeholder="sakin · Meta Sound Collection" onChange={(e) => set({ music: e.target.value })} className={input} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Açıklama ({d.caption.length}/2200)</span>
        <textarea rows={5} value={d.caption} onChange={(e) => set({ caption: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Hashtag'ler (boşluk ya da virgülle)</span>
        <input value={d.hashtags} onChange={(e) => set({ hashtags: e.target.value })} className={input} />
      </label>
      <p className="text-xs text-muted-foreground">Açıklamaya fiyat yazmayın — fiyat DM'de, AI'ın tek listesinden verilir.</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={props.busy} onClick={props.onSave} className="col-span-2 min-h-12 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50">
          {d.id ? 'Kaydet' : 'Plana ekle'}
        </button>
        <button type="button" onClick={props.onCancel} className="col-span-2 min-h-10 text-sm text-muted-foreground underline">
          Vazgeç
        </button>
      </div>
    </div>
  )
}
