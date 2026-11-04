'use server'

import {
  approveContentPublish,
  attachContentMedia,
  editContentPost,
  FirestoreContentRepository,
  instant,
  systemClock,
  withdrawContentPublish,
  type DomainError,
} from '@studio/core'
import { z } from 'zod'

import { checkContentMedia } from '../ai/content-checker'
import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'

// IG-2b — the filmed file → AI check → owner's approval. Attaching: anyone on the content screen.
// Approving / withdrawing: the owner — enforced in the domain. Publishing itself runs on the server
// (functions: contentPublisher), never from a browser.
const TEAM = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const POST_ID = z.string().regex(/^cnt_[0-9A-Z]{26}$/)
const deps = () => ({ repo: new FirestoreContentRepository(adminDb()), clock: systemClock })

export type PublishResult<T = undefined> = { ok: true; value: T } | { ok: false; error: DomainError | { code: 'upload_missing' } }

const bucket = () => adminStorage().bucket(storageBucketName())

/**
 * The file is already in `studios/{sid}/content/{postId}/…` (uploaded by the browser, rules-guarded).
 * Size and type are read from STORAGE, not from the browser; duration and dimensions come from the
 * browser (it decoded the file) and are checked against Instagram's limits by the domain.
 */
export async function attachContentMediaAction(input: unknown): Promise<PublishResult<{ aiChecked: boolean; captionUpdated: boolean }>> {
  const p = z
    .object({
      id: POST_ID,
      storagePath: z.string().max(300),
      seconds: z.number().positive().max(3600).nullable(),
      width: z.number().int().positive().max(10000),
      height: z.number().int().positive().max(10000),
      frames: z.array(z.string().max(400_000)).max(6),
    })
    .parse(input)
  const ctx = await requireTenantContext(TEAM)
  const sid = String(ctx.studioId)
  if (!p.storagePath.startsWith(`studios/${sid}/content/${p.id}/`)) return { ok: false, error: { code: 'upload_missing' } }
  const [exists] = await bucket().file(p.storagePath).exists()
  if (!exists) return { ok: false, error: { code: 'upload_missing' } }
  const [meta] = await bucket().file(p.storagePath).getMetadata()
  const contentType = String(meta.contentType ?? '')
  const bytes = Number(meta.size ?? 0)
  const kind = contentType.startsWith('video/') ? 'video' : 'image'

  const post = await deps().repo.getPost(ctx, p.id)
  if (!post) return { ok: false, error: { code: 'operation_not_applicable' } }
  const areas = (((await adminDb().doc(`studios/${sid}/settings/content`).get()).get('areas') as string[] | undefined) ?? []).map(String)
  const check = await checkContentMedia({
    format: post.format,
    title: post.title,
    shotCard: post.shotCard,
    caption: post.caption,
    hashtags: post.hashtags,
    areas,
    kind,
    seconds: kind === 'video' ? Math.round(p.seconds ?? 0) : null,
    width: p.width,
    height: p.height,
    framesJpegBase64: p.frames,
  })

  const r = await attachContentMedia(
    deps(),
    ctx,
    p.id,
    { storagePath: p.storagePath, kind, contentType, bytes, seconds: kind === 'video' ? Math.round(p.seconds ?? 0) : null, width: p.width, height: p.height },
    check ? { notes: check.notes, at: instant(systemClock.now()) } : null,
  )
  if (!r.ok) {
    await bucket().file(p.storagePath).delete({ ignoreNotFound: true }) // a refused file is not kept
    return { ok: false, error: r.error }
  }
  // The AI's final caption lands as an ordinary edit (logged, and visible before the owner approves).
  let captionUpdated = false
  if (check && check.caption.trim() && (check.caption.trim() !== r.value.caption || check.hashtags.join(' ') !== r.value.hashtags.join(' '))) {
    const e = await editContentPost(deps(), ctx, p.id, {
      scheduledFor: r.value.scheduledFor,
      format: r.value.format,
      title: r.value.title,
      shotCard: r.value.shotCard,
      caption: check.caption,
      hashtags: check.hashtags,
    })
    captionUpdated = e.ok
  }
  // The previous file (if any) is no longer referenced.
  if (post.media?.storagePath && post.media.storagePath !== p.storagePath) await bucket().file(post.media.storagePath).delete({ ignoreNotFound: true })
  return { ok: true, value: { aiChecked: Boolean(check), captionUpdated } }
}

/** A 10-minute link to look at the file before approving. */
export async function contentMediaUrlAction(input: unknown): Promise<string | null> {
  const p = z.object({ id: POST_ID }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const post = await deps().repo.getPost(ctx, p.id)
  if (!post?.media) return null
  const [exists] = await bucket().file(post.media.storagePath).exists()
  if (!exists) return null
  const [url] = await bucket().file(post.media.storagePath).getSignedUrl({ action: 'read', expires: systemClock.now() + 10 * 60_000 })
  return url
}

export async function approveContentPublishAction(input: unknown): Promise<PublishResult> {
  const p = z.object({ id: POST_ID, consentConfirmed: z.boolean(), now: z.boolean().optional() }).parse(input)
  const ctx = await requireTenantContext(TEAM) // the domain refuses anyone but the owner
  const r = await approveContentPublish(deps(), ctx, p.id, p.consentConfirmed, { now: p.now ?? false })
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}

export async function withdrawContentPublishAction(input: unknown): Promise<PublishResult> {
  const p = z.object({ id: POST_ID }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await withdrawContentPublish(deps(), ctx, p.id)
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}
