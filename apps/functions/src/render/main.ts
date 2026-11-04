// IG-2c — the content-render JOB (Cloud Run job `content-render`, europe-west1). One run = one edit
// request of one post. Started by onEventCreated on `content_post.edit_requested`.
//
//   download raw clips → (first edit) transcribe speech with whisper.cpp + take small frames → the AI
//   decides the cut → (re-edit) the old cut with a person's changes → ffmpeg renders 1080×1920 with
//   subtitles, hook and music → upload → the file goes on the post (`completeContentEdit`).
//
// Video and audio never leave this container: the AI receives small frames and the transcript only.
// A result is accepted only for the request it answers (domain); a duplicate run's file is deleted.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  applyEditOverrides,
  completeContentEdit,
  editContentPost,
  failContentEdit,
  FirestoreContentRepository,
  normalizeEditPlan,
  systemClock,
  type ContentEditPlan,
  type ContentPost,
  type MusicTrack,
  type TenantContext,
  type TranscriptLine,
} from '@studio/core'
import { getStorage } from 'firebase-admin/storage'

import { db } from '../shared/firebase'
import { buildAss } from './ass'
import { renderArgs } from './ffmpeg'
import { planEdit, plannerPrompt, type PlannerClip } from './planner'
import { parseWhisper } from './whisper'

const run = promisify(execFile)
const WHISPER = process.env.WHISPER_BIN ?? '/opt/whisper/whisper-cli'
const MODEL = process.env.WHISPER_MODEL ?? '/opt/whisper/ggml-medium-q5_0.bin'
const FONTS = process.env.FONTS_DIR ?? '/usr/share/fonts/truetype/dejavu'

type Stage = 'download' | 'transcribe' | 'plan' | 'render' | 'upload' | 'unknown'
class Failed extends Error {
  constructor(
    readonly stage: Stage,
    message: string,
  ) {
    super(message)
  }
}
const at = async <T>(stage: Stage, f: () => Promise<T>): Promise<T> => {
  try {
    return await f()
  } catch (e) {
    throw e instanceof Failed ? e : new Failed(stage, (e as Error)?.message ?? String(e))
  }
}

const deps = () => ({ repo: new FirestoreContentRepository(db()), clock: systemClock })
const systemCtx = (studioId: string) => ({ studioId, branchIds: [], role: 'system', actor: { type: 'system', id: 'content_editor' } }) as unknown as TenantContext
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ severity: 'INFO', message: `content-render: ${msg}`, ...extra }))

async function probe(path: string): Promise<{ seconds: number; width: number; height: number; hasAudio: boolean }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], { maxBuffer: 8 << 20 })
  const d = JSON.parse(stdout) as { streams?: { codec_type?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string } }
  const v = d.streams?.find((s) => s.codec_type === 'video')
  const rot = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((x) => x.rotation != null)?.rotation ?? 0)) % 180 === 90
  return {
    seconds: Number(d.format?.duration ?? 0),
    width: Number(rot ? v?.height : v?.width) || 0,
    height: Number(rot ? v?.width : v?.height) || 0,
    hasAudio: Boolean(d.streams?.some((s) => s.codec_type === 'audio')),
  }
}

async function transcribe(dir: string, slot: number, clip: string): Promise<TranscriptLine[]> {
  const wav = join(dir, `a${slot}.wav`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  const base = join(dir, `t${slot}`)
  await run(WHISPER, ['-m', MODEL, '-l', 'tr', '-t', String(Math.max(1, cpus().length)), '-oj', '-of', base, '-np', '-f', wav], { maxBuffer: 32 << 20, timeout: 12 * 60_000 })
  return parseWhisper(await readFile(`${base}.json`, 'utf8'), slot)
}

async function frames(dir: string, slot: number, clip: string, seconds: number, n: number): Promise<PlannerClip['frames']> {
  const out: { at: number; jpegBase64: string }[] = []
  for (let k = 0; k < n; k++) {
    const t = Math.min(Math.max(0.2, ((k + 0.5) / n) * seconds), Math.max(0, seconds - 0.1))
    const file = join(dir, `f${slot}_${k}.jpg`)
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', clip, '-frames:v', '1', '-vf', 'scale=384:-2', '-q:v', '6', file])
    out.push({ at: t, jpegBase64: (await readFile(file)).toString('base64') })
  }
  return out
}

async function main(): Promise<void> {
  const sid = process.env.STUDIO_ID ?? ''
  const postId = process.env.POST_ID ?? ''
  const key = process.env.ANTHROPIC_API_KEY ?? ''
  if (!sid || !/^cnt_[0-9A-Z]{26}$/.test(postId)) throw new Error('STUDIO_ID / POST_ID missing')
  const ctx = systemCtx(sid)
  const post = await deps().repo.getPost(ctx, postId)
  if (!post?.edit || post.edit.status !== 'rendering') return log('nothing to render', { postId })
  const requestId = post.edit.requestId
  const dir = await mkdtemp(join(tmpdir(), 'render-'))
  const bucket = getStorage().bucket()
  let uploaded: string | null = null
  try {
    const settings = await db().doc(`studios/${sid}/settings/content`).get()
    const tracks = ((settings.get('music') as MusicTrack[] | undefined) ?? []).filter((t) => t && typeof t.id === 'string')
    const areas = ((settings.get('areas') as string[] | undefined) ?? []).map(String)

    // 1 · the raw clips
    const clips = await at('download', async () =>
      Promise.all(
        (post.rawClips ?? []).map(async (c) => {
          const path = join(dir, `c${c.slot}.${c.contentType === 'video/quicktime' ? 'mov' : 'mp4'}`)
          await bucket.file(c.storagePath).download({ destination: path })
          return { slot: c.slot, path, ...(await probe(path)) }
        }),
      ),
    )
    const bySlot = new Map(clips.map((c) => [c.slot, c]))

    // 2 · the plan: the AI's (first edit) or the old one with a person's changes (re-edit)
    let plan: ContentEditPlan
    let caption: { caption: string; hashtags: readonly string[] } | null = null
    if (post.edit.overrides && post.edit.plan) {
      plan = applyEditOverrides(post.edit.plan, post.edit.overrides, tracks)
    } else {
      const transcript = await at('transcribe', async () => {
        const all: TranscriptLine[] = []
        for (const c of clips) if (c.hasAudio) all.push(...(await transcribe(dir, c.slot, c.path)))
        return all
      })
      const perClip = clips.length <= 3 ? 5 : clips.length <= 5 ? 4 : 3
      const planned = await at('plan', async () => {
        if (!key) throw new Error('ANTHROPIC_API_KEY missing')
        const pc: PlannerClip[] = []
        for (const c of clips) pc.push({ slot: c.slot, seconds: c.seconds, frames: await frames(dir, c.slot, c.path, c.seconds, perClip) })
        const proposal = await planEdit(key, plannerPrompt(post, pc, transcript, tracks, areas), pc)
        const n = normalizeEditPlan(
          proposal,
          clips.map((c) => ({ slot: c.slot, seconds: c.seconds })),
          transcript,
          tracks,
        )
        if (!n.ok) throw new Error('AI kullanılabilir bir kurgu çıkaramadı (3 saniyeden kısa).')
        return { plan: n.value, caption: { caption: proposal.caption, hashtags: proposal.hashtags } }
      })
      plan = planned.plan
      caption = planned.caption
    }

    // 3 · render
    const out = join(dir, 'out.mp4')
    await at('render', async () => {
      const track = plan.musicTrackId ? tracks.find((t) => t.id === plan.musicTrackId) : undefined
      let musicPath: string | null = null
      if (track) {
        musicPath = join(dir, 'music.mp3')
        await bucket.file(track.storagePath).download({ destination: musicPath })
      }
      let assPath: string | null = null
      if (plan.hook || (plan.subtitles && plan.lines.length)) {
        assPath = join(dir, 'subs.ass')
        await writeFile(assPath, buildAss(plan), 'utf8')
      }
      const segments = plan.segments.map((s) => {
        const c = bySlot.get(s.slot)
        if (!c) throw new Error(`klip ${s.slot + 1} yok`)
        return { path: c.path, from: s.from, to: s.to, hasAudio: c.hasAudio }
      })
      await run('ffmpeg', renderArgs({ segments, seconds: plan.seconds, musicPath, speech: plan.lines.length > 0, assPath, fontsDir: FONTS, out }), {
        maxBuffer: 32 << 20,
        timeout: 20 * 60_000,
      })
    })

    // 4 · upload and attach
    const info = await probe(out)
    const bytes = (await stat(out)).size
    uploaded = `studios/${sid}/content/${postId}/${randomUUID()}.mp4`
    const dest = uploaded
    await at('upload', () => bucket.upload(out, { destination: dest, contentType: 'video/mp4', resumable: true }).then(() => undefined))
    const done = await completeContentEdit(deps(), ctx, postId, {
      requestId,
      plan,
      media: { storagePath: uploaded, kind: 'video', contentType: 'video/mp4', bytes, seconds: Math.round(info.seconds), width: info.width, height: info.height },
    })
    if (!done.ok) {
      log('result refused (another request owns the post)', { postId, code: done.error.code })
      await bucket.file(uploaded).delete({ ignoreNotFound: true })
      return
    }
    uploaded = null
    const old = post.media?.storagePath
    if (old && old !== done.value.media?.storagePath && !(post.rawClips ?? []).some((c) => c.storagePath === old)) await bucket.file(old).delete({ ignoreNotFound: true })
    // The AI's final caption lands as an ordinary edit (logged, visible before the owner approves).
    if (caption && caption.caption.trim() && (caption.caption.trim() !== done.value.caption || caption.hashtags.join(' ') !== done.value.hashtags.join(' '))) {
      const p: ContentPost = done.value
      await editContentPost(deps(), ctx, postId, { scheduledFor: p.scheduledFor, format: p.format, title: p.title, shotCard: p.shotCard, caption: caption.caption, hashtags: caption.hashtags })
    }
    log('rendered', { postId, seconds: plan.seconds, segments: plan.segments.length, lines: plan.lines.length })
  } catch (e) {
    const f = e instanceof Failed ? e : new Failed('unknown', (e as Error)?.message ?? String(e))
    console.error(JSON.stringify({ severity: 'ERROR', message: 'content-render: failed', postId, stage: f.stage, error: f.message.slice(0, 500) }))
    if (uploaded) await bucket.file(uploaded).delete({ ignoreNotFound: true }).catch(() => undefined)
    await failContentEdit(deps(), ctx, postId, { requestId, stage: f.stage, message: humanMessage(f) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function humanMessage(f: Failed): string {
  switch (f.stage) {
    case 'download':
      return 'Ham klipler indirilemedi; klipleri yeniden yükleyin.'
    case 'transcribe':
      return 'Konuşma yazıya dökülemedi. Tekrar deneyin.'
    case 'plan':
      return f.message.startsWith('AI ') ? f.message : 'AI kurgu kararı veremedi. Tekrar deneyin.'
    case 'render':
      return 'Video kesilemedi; kliplerden biri bozuk olabilir. Klibi değiştirip tekrar deneyin.'
    case 'upload':
      return 'Kurgulanan video kaydedilemedi. Tekrar deneyin.'
    default:
      return 'Kurgu tamamlanamadı. Tekrar deneyin.'
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'content-render: crashed', error: (e as Error)?.message }))
    process.exit(1)
  },
)
