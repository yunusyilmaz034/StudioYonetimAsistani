'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon, ScissorsIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { domainErrorMessage } from '@/lib/domain-error'
import { prepareRawClip, uploadRawClip } from '@/lib/content-upload'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import type { ContentWeek } from '@/server/actions/content'
import type { PublishResult } from '@/server/actions/content-publish'
import { addRawClipAction, musicLibraryAction, requestContentEditAction, type MusicLibrary } from '@/server/actions/content-edit'

// IG-2c — onaylı tasarım: https://claude.ai/artifact/LqEeL8QqZK7W9LuzSeLana
// Raw clips (anyone) → "AI kurgula" → the server cuts it → the result lands in the publish panel below.

type Post = ContentWeek['posts'][number]

const MAX_CLIPS = 8
const STALE_MS = 30 * 60_000
const sec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function explain(r: PublishResult<unknown>): string {
  if (r.ok) return ''
  return r.error.code === 'upload_missing' ? 'Klip yüklenemedi; tekrar deneyin.' : domainErrorMessage(r.error)
}

export function EditPanel({ post, studioId, reload }: { post: Post; studioId: string; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState<{ slot: number; pct: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [lib, setLib] = useState<MusicLibrary | null>(null)
  const clips = post.rawClips ?? []
  const edit = post.edit ?? null
  const now = Date.now()
  const rendering = edit?.status === 'rendering' && now - (edit.requestedAt as number) <= STALE_MS
  const stale = edit?.status === 'rendering' && !rendering
  const planned = post.shotCard.clips.length
  const bySlot = new Map(clips.map((c) => [c.slot, c]))
  const extras = clips.filter((c) => c.slot >= planned)
  const nextExtra = Array.from({ length: MAX_CLIPS }, (_, i) => i).find((i) => i >= planned && !bySlot.has(i))
  const missing = post.shotCard.clips.filter((_, i) => !bySlot.has(i)).length

  // While the server cuts, look again every 15 seconds.
  useEffect(() => {
    if (!rendering) return
    const t = setInterval(() => void reload(), 15_000)
    return () => clearInterval(t)
  }, [rendering, reload])

  useEffect(() => {
    if (editing && !lib) void musicLibraryAction().then(setLib).catch(() => setLib({ tracks: [], canEdit: false }))
  }, [editing, lib])

  if (post.format !== 'reels' || post.status === 'publishing' || post.status === 'published') return null

  async function act(key: string, f: () => Promise<PublishResult>, okMsg: string) {
    setBusy(key)
    try {
      const r = await f()
      if (!r.ok) toast.error(explain(r))
      else toast.success(okMsg)
      await reload()
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : (e as Error)?.message || 'İşlem tamamlanamadı.')
    }
    setBusy(null)
    setPct(null)
  }

  async function onClip(slot: number, file: File | undefined) {
    if (!file) return
    await act(
      `clip${slot}`,
      async () => {
        const prepared = await prepareRawClip(file)
        setPct({ slot, pct: 0 })
        const storagePath = await uploadRawClip({ studioId, postId: post.id, file: prepared, onProgress: (p) => setPct({ slot, pct: p }) })
        setPct(null)
        return addRawClipAction({ id: post.id, slot, storagePath, seconds: prepared.seconds, width: prepared.width, height: prepared.height })
      },
      'Klip yüklendi.',
    )
  }

  const pick = (slot: number, label: string) => (
    <label className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-medium ${busy !== null || rendering ? 'pointer-events-none opacity-50' : ''}`}>
      {busy === `clip${slot}` ? <Loader2Icon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
      {pct?.slot === slot ? `%${pct.pct}` : label}
      <input type="file" accept="video/mp4,video/quicktime" className="sr-only" onChange={(e) => void onClip(slot, e.target.files?.[0])} />
    </label>
  )

  const row = (slot: number, title: string, sub: string) => {
    const c = bySlot.get(slot)
    return (
      <li key={slot} className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2">
        <span className={`h-10 w-6 shrink-0 rounded ${c ? 'bg-primary/20' : 'border border-dashed border-border'}`} />
        <span className="min-w-0 flex-1 text-xs">
          <b className="block text-sm">{title}</b>
          {c ? `yüklendi · ${sec(c.seconds)}` : sub}
        </span>
        {c ? <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success">Var</span> : <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning">Eksik</span>}
        {pick(slot, c ? 'Değiştir' : 'Yükle')}
      </li>
    )
  }

  const plan = edit?.plan ?? null

  return (
    <div className="space-y-2.5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold">
        <ScissorsIcon className="size-4" /> AI kurgu
      </h3>

      <ul className="space-y-1.5">
        {post.shotCard.clips.map((c, i) => row(i, `${i + 1} · ${c.what}`, `${c.angle ? `${c.angle} · ` : ''}${c.seconds} sn planlı`))}
        {extras.map((c) => row(c.slot, 'Ek klip', ''))}
      </ul>
      {nextExtra != null && !rendering ? <div className="flex justify-end">{pick(nextExtra, 'Ek klip ekle')}</div> : null}
      <p className="text-xs text-muted-foreground">En fazla 8 klip, toplam 1 GB. Sıra ve kesimi AI belirler.</p>

      {rendering ? (
        <div className="space-y-1.5 rounded-lg bg-info/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <Loader2Icon className="size-4 animate-spin" /> Kurgulanıyor…
          </p>
          <p className="text-xs text-muted-foreground">
            {edit?.overrides ? 'Değişikliklerinle yeniden kesiliyor.' : 'Konuşma yazıya dökülüyor, AI kurgu kararını veriyor, video kesilip altyazı basılıyor.'} Genelde 2–4 dakika sürer; sayfadan çıkabilirsiniz.
          </p>
        </div>
      ) : null}

      {stale ? <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs">Kurgu yarıda kaldı. Tekrar deneyin.</p> : null}

      {edit?.status === 'failed' && edit.failure ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs">
          <b>Kurgu olmadı.</b> {edit.failure.message} Ham klipler duruyor, hiçbir şey yayınlanmadı.
        </p>
      ) : null}

      {plan && !rendering ? <PlanSummary plan={plan} /> : null}

      {!rendering && clips.length > 0 ? (
        <div className="grid gap-2">
          {missing > 0 && !plan ? <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs">{missing} klip eksik. Yine de kurgulatabilirsiniz; AI eldeki kliplerle kurar.</p> : null}
          {plan && edit?.status === 'ready' ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy !== null} onClick={() => setEditing((v) => !v)} className="min-h-11 rounded-lg border border-border bg-card text-sm font-medium disabled:opacity-50">
                {editing ? 'Düzenlemeyi kapat' : 'Kurguyu düzenle'}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void act('edit', () => requestContentEditAction({ id: post.id, overrides: null }), 'AI baştan kurguluyor.')} className="min-h-11 rounded-lg border border-border bg-card text-sm disabled:opacity-50">
                AI baştan kurgulasın
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('edit', () => requestContentEditAction({ id: post.id, overrides: null }), 'Kurgu başladı. Birkaç dakika sürer.')}
              className="min-h-12 w-full rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy === 'edit' ? 'Başlatılıyor…' : edit?.status === 'failed' || stale ? 'Tekrar dene' : 'AI kurgula'}
            </button>
          )}
        </div>
      ) : null}

      {editing && plan && edit?.status === 'ready' ? (
        <EditSheet
          plan={plan}
          lib={lib}
          busy={busy === 'redo'}
          onCancel={() => setEditing(false)}
          onSubmit={(o) => {
            setEditing(false)
            void act('redo', () => requestContentEditAction({ id: post.id, overrides: o }), 'Yeniden kurgulanıyor.')
          }}
        />
      ) : null}
    </div>
  )
}

type Plan = NonNullable<NonNullable<Post['edit']>['plan']>

function PlanSummary({ plan }: { plan: Plan }) {
  let t = 0
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Kurgu · {sec(plan.seconds)} · {plan.segments.length} parça{plan.subtitles ? ' · altyazılı' : ''}
        {plan.hook ? ` · kanca “${plan.hook}”` : ''}
      </p>
      <div className="flex h-6 overflow-hidden rounded-md text-[10px] font-semibold text-primary-foreground" aria-label="Kurgu sırası">
        {plan.segments.map((s, i) => (
          <span key={i} className="grid min-w-0 place-items-center border-r-2 border-card bg-primary" style={{ flex: s.to - s.from, opacity: 1 - (i % 3) * 0.15 }}>
            {s.slot + 1}
          </span>
        ))}
      </div>
      <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
        {plan.segments.map((s, i) => {
          const from = t
          t += s.to - s.from
          return (
            <li key={i}>
              {sec(from)}–{sec(t)} · klip {s.slot + 1} · {s.from.toFixed(1)}–{s.to.toFixed(1)} sn
              {plan.coverAt >= from && plan.coverAt < t ? ' · kapak' : ''}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function EditSheet({
  plan,
  lib,
  busy,
  onCancel,
  onSubmit,
}: {
  plan: Plan
  lib: MusicLibrary | null
  busy: boolean
  onCancel: () => void
  onSubmit: (o: { hook: string; lines: { id: string; text: string }[]; musicTrackId: string | null; subtitles: boolean }) => void
}) {
  const [hook, setHook] = useState(plan.hook)
  const [lines, setLines] = useState(() => plan.lines.map((l) => ({ id: l.id, start: l.start, text: l.text, unsure: l.unsure })))
  const [music, setMusic] = useState<string | null>(plan.musicTrackId)
  const [subs, setSubs] = useState(plan.subtitles)
  const tracks = (lib?.tracks ?? []).filter((t) => t.active)
  const chip = (on: boolean) => `min-h-9 rounded-full border px-3 text-xs ${on ? 'border-primary bg-primary/10 font-semibold' : 'border-border bg-card'}`

  return (
    <div className="space-y-3 rounded-xl border-[1.5px] border-primary bg-card p-3">
      <h4 className="text-sm font-bold">Kurguyu düzenle</h4>
      <label className="grid gap-1 text-xs font-semibold" htmlFor="edit-hook">
        Kanca yazısı (ilk 3 sn)
        <input id="edit-hook" value={hook} maxLength={120} onChange={(e) => setHook(e.target.value)} className="min-h-10 rounded-lg border border-border bg-background px-3 text-sm font-normal" />
      </label>
      {lines.length ? (
        <div className="grid gap-1.5 text-xs font-semibold">
          Altyazı
          {lines.map((l, i) => (
            <div key={l.id} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2">
              <code className="font-mono text-[11px] font-normal text-muted-foreground">{sec(l.start)}</code>
              <input
                id={`line-${l.id}`}
                aria-label={`Altyazı satırı ${sec(l.start)}`}
                value={l.text}
                maxLength={120}
                onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
                className={`min-h-9 rounded-lg border px-2.5 text-sm font-normal ${l.unsure ? 'border-warning bg-warning/10' : 'border-border bg-background'}`}
              />
            </div>
          ))}
          {lines.some((l) => l.unsure) ? <p className="font-normal text-muted-foreground">Sarı satırlarda AI duyduğundan emin olamadı.</p> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Videoda konuşma yok; altyazı çıkmaz.</p>
      )}
      <div className="grid gap-1.5 text-xs font-semibold">
        Müzik
        <div className="flex flex-wrap gap-1.5">
          {lib === null ? <span className="font-normal text-muted-foreground">Yükleniyor…</span> : null}
          {tracks.map((t) => (
            <button key={t.id} type="button" onClick={() => setMusic(t.id)} className={chip(music === t.id)}>
              {t.name} · {sec(t.seconds)}
            </button>
          ))}
          <button type="button" onClick={() => setMusic(null)} className={chip(music === null)}>
            Müziksiz, kendi sesi
          </button>
        </div>
      </div>
      {lines.length ? (
        <div className="grid gap-1.5 text-xs font-semibold">
          Altyazı görünsün mü
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setSubs(true)} className={chip(subs)}>
              Açık
            </button>
            <button type="button" onClick={() => setSubs(false)} className={chip(!subs)}>
              Kapalı
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border bg-card text-sm">
          Vazgeç
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit({ hook, lines: lines.map((l) => ({ id: l.id, text: l.text })), musicTrackId: music, subtitles: subs })}
          className="min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Yeniden kurgula
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Yeniden kurgu yeni bir video üretir. Onay verilmişse düşer.</p>
    </div>
  )
}
