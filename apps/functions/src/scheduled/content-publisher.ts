// IG-2b (2026-11-04) — publishes owner-APPROVED posts at their time. Runs every 5 minutes.
//
//   1. the lock (`startContentPublishing`, a transaction) — only one run gets a post; no double post;
//   2. a temporary download token on the private file → Instagram container → processed → publish;
//   3. the outcome is recorded: published (with the Instagram id) or failed (stage + Meta's reason).
//
// A run that died after taking the lock is caught 20 minutes later and marked failed with "durum
// belirsiz" — it MAY have been published, so the owner checks Instagram before approving again.
import {
  allStudioIds,
  FirestoreContentRepository,
  isStalePublishing,
  markContentPublished,
  markContentPublishFailed,
  MEDIA_RETENTION_DAYS,
  publishCaption,
  startContentPublishing,
  systemClock,
  type ContentPost,
  type TenantContext,
} from '@studio/core'
import { randomUUID } from 'node:crypto'

import { getStorage } from 'firebase-admin/storage'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'
import { containerParams, containerState } from './content-publish-graph'

const GRAPH = 'https://graph.facebook.com/v21.0'

type StorageFile = ReturnType<ReturnType<ReturnType<typeof getStorage>['bucket']>['file']>

// Meta fetches the file by URL. The functions' service account cannot SIGN URLs (no signBlob — and
// granting it is an IAM change we do not make silently), so the file gets a Firebase download token
// for the few minutes of publishing only, and loses it right after — success or failure.
async function openForMeta(file: StorageFile): Promise<string> {
  const token = randomUUID()
  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
  return `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`
}
async function closeForMeta(file: StorageFile): Promise<void> {
  try {
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } })
  } catch (e) {
    logger.warn('content-publisher: download token not removed', { path: file.name, error: (e as Error)?.message })
  }
}
const deps = () => ({ repo: new FirestoreContentRepository(db()), clock: systemClock })
const systemCtx = (studioId: string) => ({ studioId, branchIds: [], role: 'system', actor: { type: 'system', id: 'content_publisher' } }) as unknown as TenantContext

class Stage extends Error {
  constructor(
    readonly stage: 'media_url' | 'container' | 'processing' | 'publish' | 'unknown',
    readonly metaCode: string | null,
    message: string,
  ) {
    super(message)
  }
}

async function graph(path: string, token: string, init?: { method: 'POST'; params: Record<string, string> }, stage: Stage['stage'] = 'unknown') {
  const url = `${GRAPH}/${path}`
  const res = init
    ? await fetch(url, { method: 'POST', body: new URLSearchParams({ ...init.params, access_token: token }), signal: AbortSignal.timeout(60_000) })
    : await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: number; error_user_msg?: string; message?: string } }
  if (!res.ok || d.error) throw new Stage(stage, d.error?.code != null ? String(d.error.code) : null, d.error?.error_user_msg || d.error?.message || `HTTP ${res.status}`)
  return d
}

async function publishOne(studioId: string, igUserId: string, token: string, post: ContentPost, deadline: number): Promise<void> {
  const ctx = systemCtx(studioId)
  const locked = await startContentPublishing(deps(), ctx, post.id)
  if (!locked.ok) return // someone else has it, or it is no longer due
  const p = locked.value
  let file: StorageFile | null = null
  try {
    if (!p.media) throw new Stage('media_url', null, 'Dosya yok')
    file = getStorage().bucket().file(p.media.storagePath)
    const [exists] = await file.exists()
    if (!exists) throw new Stage('media_url', null, 'Dosya bulunamadı; yeniden yükleyin.')
    const url = await openForMeta(file)
    const container = await graph(`${igUserId}/media`, token, { method: 'POST', params: containerParams({ format: p.format, kind: p.media.kind, url, caption: publishCaption(p) }) }, 'container')
    const creationId = String(container.id ?? '')
    for (;;) {
      const st = await graph(`${creationId}?fields=status_code,status`, token, undefined, 'processing')
      const s = containerState(st.status_code as string | undefined)
      if (s === 'ready') break
      if (s === 'error') throw new Stage('processing', null, String(st.status ?? 'Instagram dosyayı işleyemedi.'))
      if (Date.now() > deadline) throw new Stage('processing', null, 'Instagram dosyayı zamanında işleyemedi; yeniden onaylayın.')
      await new Promise((r) => setTimeout(r, 5_000))
    }
    const published = await graph(`${igUserId}/media_publish`, token, { method: 'POST', params: { creation_id: creationId } }, 'publish')
    const igMediaId = String(published.id ?? '')
    let permalink: string | null = null
    try {
      permalink = String((await graph(`${igMediaId}?fields=permalink`, token)).permalink ?? '') || null
    } catch {
      /* the post is out; the link is a convenience */
    }
    await markContentPublished(deps(), ctx, p.id, { igMediaId, permalink })
    logger.info('content-publisher: published', { studioId, id: p.id, igMediaId })
  } catch (e) {
    const s = e instanceof Stage ? e : new Stage('unknown', null, (e as Error)?.message ?? 'bilinmeyen hata')
    logger.error('content-publisher: failed', { studioId, id: p.id, stage: s.stage, metaCode: s.metaCode })
    await markContentPublishFailed(deps(), ctx, p.id, { stage: s.stage, metaCode: s.metaCode, message: s.message })
  } finally {
    if (file) await closeForMeta(file)
  }
}

export async function runContentPublisher(now: number): Promise<void> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN
  if (!token) {
    logger.error('content-publisher: INSTAGRAM_ACCESS_TOKEN missing')
    return
  }
  const deadline = now + 7 * 60_000 // the function has 9 minutes
  for (const studioId of await allStudioIds(db())) {
    const sid = String(studioId)
    try {
      const ctx = systemCtx(sid)
      // Runs that died mid-way.
      for (const p of await deps().repo.listByStatus(ctx, 'publishing')) {
        if (!isStalePublishing(p, now)) continue
        await markContentPublishFailed(deps(), ctx, p.id, { stage: 'unknown', metaCode: null, message: 'Durum belirsiz: yayın yarıda kaldı. Instagram’da yayınlanmış olabilir; kontrol edip öyle onaylayın.' })
      }
      const due = (await deps().repo.listByStatus(ctx, 'scheduled')).filter((p) => p.publish && (p.publish.publishAt as number) <= now)
      if (due.length === 0) continue
      const igUserId = String((await db().doc(`studios/${sid}/settings/content`).get()).get('igUserId') ?? '')
      if (!/^\d+$/.test(igUserId)) {
        logger.error('content-publisher: settings/content.igUserId missing', { studioId: sid })
        continue
      }
      for (const p of due) {
        if (Date.now() > deadline) break // the next run takes the rest
        await publishOne(sid, igUserId, token, p, deadline)
      }
    } catch (e) {
      logger.error('content-publisher: studio failed', { studioId: sid, error: (e as Error)?.message })
    }
  }
}

/** Daily: files of posts published more than 90 days ago are deleted (owner). Instagram keeps the post. */
export async function runContentRetention(now: number): Promise<void> {
  for (const studioId of await allStudioIds(db())) {
    const sid = String(studioId)
    const posts = await deps().repo.listByStatus(systemCtx(sid), 'published')
    for (const p of posts) {
      const at = p.publish?.publishedAt as number | undefined
      if (!p.media || at == null || now - at < MEDIA_RETENTION_DAYS * 86_400_000) continue
      await getStorage().bucket().file(p.media.storagePath).delete({ ignoreNotFound: true })
    }
  }
}
