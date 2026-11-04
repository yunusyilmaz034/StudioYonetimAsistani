'use client'

import { useState } from 'react'
import { ExternalLinkIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { domainErrorMessage } from '@/lib/domain-error'
import { prepareContentFile, uploadContentFile } from '@/lib/content-upload'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import type { ContentWeek } from '@/server/actions/content'
import {
  approveContentPublishAction,
  attachContentMediaAction,
  contentMediaUrlAction,
  withdrawContentPublishAction,
  type PublishResult,
} from '@/server/actions/content-publish'

// IG-2b — onaylı tasarım: https://claude.ai/artifact/C7VnUHuAFxzcpcuME9Wzp8
// Upload (anyone) → AI check → the owner approves THIS file and caption → the server publishes at the
// planned time. The approve button says when it will go out.

type Post = ContentWeek['posts'][number]

const IST = 3 * 3_600_000
const when = (t: number) =>
  new Date(t).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
const RETENTION_DAYS = 90
const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`

function explain(r: PublishResult<unknown>): string {
  if (r.ok) return ''
  return r.error.code === 'upload_missing' ? 'Dosya yüklenemedi; tekrar deneyin.' : domainErrorMessage(r.error)
}

export function PublishPanel({ post, studioId, canApprove, reload }: { post: Post; studioId: string; canApprove: boolean; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [consent, setConsent] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const media = post.media ?? null
  const pub = post.publish ?? null
  const accept = post.format === 'reels' ? 'video/mp4,video/quicktime' : post.format === 'photo' ? 'image/*' : 'video/mp4,video/quicktime,image/*'

  async function act<T>(key: string, f: () => Promise<PublishResult<T>>, ok: (v: T) => string) {
    setBusy(key)
    try {
      const r = await f()
      if (!r.ok) toast.error(explain(r))
      else toast.success(ok(r.value))
      await reload()
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : (e as Error)?.message || 'İşlem tamamlanamadı.')
    }
    setBusy(null)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    await act(
      'upload',
      async () => {
        const prepared = await prepareContentFile(file)
        setPct(0)
        const storagePath = await uploadContentFile({ studioId, postId: post.id, file: prepared, onProgress: setPct })
        setPct(null)
        return attachContentMediaAction({ id: post.id, storagePath, seconds: prepared.seconds, width: prepared.width, height: prepared.height, frames: prepared.frames })
      },
      (v) => (v.aiChecked ? 'Yüklendi. AI kontrol etti; notlara bakın.' : 'Yüklendi. AI şu an bakamadı; dosyayı kendiniz kontrol edin.'),
    )
    setPct(null)
    setPreview(null)
  }

  async function showPreview() {
    setBusy('preview')
    try {
      setPreview(await contentMediaUrlAction({ id: post.id }))
    } catch {
      toast.error('Önizleme açılamadı.')
    }
    setBusy(null)
  }

  if (post.status === 'published' && pub) {
    const purge = (pub.publishedAt as number) + RETENTION_DAYS * 86_400_000
    return (
      <div className="space-y-2 rounded-lg bg-success/10 p-3">
        <p className="text-sm font-semibold">Yayında · {when(pub.publishedAt as number)}</p>
        <p className="text-xs text-muted-foreground">Dosya {new Date(purge + IST).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' })}'da panelden silinecek; Instagram'daki gönderi kalır.</p>
        {pub.permalink ? (
          <a href={pub.permalink} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium">
            <ExternalLinkIcon className="size-4" /> Instagram'da aç
          </a>
        ) : null}
      </div>
    )
  }

  if (post.status === 'publishing') {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-info/10 p-3 text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Instagram'a gönderiliyor… Video işlenirken birkaç dakika sürebilir.
      </p>
    )
  }

  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-bold">Dosya ve yayın</h3>

      {post.status === 'failed' && pub?.failure ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs">
          <b>Instagram kabul etmedi.</b> Meta: “{pub.failure.message}”. Hiçbir şey yayınlanmadı. Dosyayı değiştirin ya da yeniden onaylayın.
        </p>
      ) : null}

      {media ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">
            {media.kind === 'video' ? `Video · ${media.seconds} sn` : 'Fotoğraf'} · {media.width}×{media.height} · {mb(media.bytes)}
          </p>
          {preview ? (
            media.kind === 'video' ? (
              <video src={preview} controls playsInline className="max-h-96 w-full rounded-lg bg-black" />
            ) : (
              <img src={preview} alt="Yüklenen fotoğraf" className="max-h-96 w-full rounded-lg object-contain" />
            )
          ) : (
            <button type="button" disabled={busy !== null} onClick={() => void showPreview()} className="min-h-10 w-full rounded-lg border border-border bg-card text-sm disabled:opacity-50">
              {busy === 'preview' ? 'Açılıyor…' : 'Dosyayı izle'}
            </button>
          )}
          {post.aiCheck?.notes.length ? (
            <ul className="space-y-1 text-xs">
              {post.aiCheck.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`mt-1 size-2 shrink-0 rounded-full ${n.level === 'warn' ? 'bg-warning' : 'bg-success'}`} />
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          {post.format === 'reels' ? 'Reels: dikey video (MP4/MOV), 3 sn – 15 dk, en fazla 300 MB.' : post.format === 'photo' ? 'Fotoğraf: en-boy 4:5 ile 1.91:1 arası.' : 'Hikâye: video en fazla 60 sn ya da fotoğraf.'}
        </p>
      )}

      {pct !== null ? (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded bg-border">
            <i className="block h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Yükleniyor %{pct}. Sayfadan çıkmayın.</p>
        </div>
      ) : null}

      {post.status !== 'scheduled' ? (
        <label className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium ${busy !== null ? 'pointer-events-none opacity-50' : ''}`}>
          {busy === 'upload' ? <Loader2Icon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
          {busy === 'upload' && pct === null ? 'AI kontrol ediyor…' : media ? 'Dosyayı değiştir' : 'Dosya yükle'}
          <input type="file" accept={accept} className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      ) : null}

      {post.status === 'scheduled' && pub ? (
        <div className="space-y-2 rounded-lg bg-info/10 p-3">
          <p className="text-sm font-semibold">Yayına hazır · {when(pub.publishAt as number)}</p>
          <p className="text-xs text-muted-foreground">Saatinde kendiliğinden yayınlanır. Dosya ya da açıklama değişirse onay düşer.</p>
          {canApprove ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void act('withdraw', () => withdrawContentPublishAction({ id: post.id }), () => 'Onay geri alındı.')} className="min-h-11 rounded-lg border border-border bg-card text-sm disabled:opacity-50">
                Onayı geri al
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act('now', () => approveContentPublishAction({ id: post.id, consentConfirmed: true, now: true }), () => 'Birkaç dakika içinde yayınlanacak.')}
                className="min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Şimdi yayınla
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {media && post.status !== 'scheduled' ? (
        canApprove ? (
          <div className="space-y-2">
            <label className="flex min-h-11 items-start gap-2.5 rounded-lg border border-border p-3 text-sm">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-primary" />
              <span>Görüntüdeki üyelerin izni alındı (KVKK). Yüz görünmüyorsa da işaretleyin.</span>
            </label>
            <button
              type="button"
              disabled={busy !== null || !consent}
              onClick={() => void act('approve', () => approveContentPublishAction({ id: post.id, consentConfirmed: consent }), () => 'Onaylandı; saatinde yayınlanacak.')}
              className="min-h-12 w-full rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              Onayla · {when(Math.max(post.scheduledFor as number, Date.now()))}'da yayınlanır
            </button>
          </div>
        ) : (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Sahibin onayını bekliyor.</p>
        )
      ) : null}
    </div>
  )
}
