// PURE decisions for publishing a filmed post to Instagram (IG-2b, 2026-11-04). Owner's rules:
//
//   · Anyone who can open the content screen attaches the file; ONLY the owner approves publishing.
//   · No approval without the file, and without "everyone visible has agreed" (KVKK) ticked.
//   · The post goes out at its planned time; approved after that time → at the next run (a few minutes).
//   · A new file, or an edited caption, after approval withdraws the approval (the owner approved THAT).
//   · scheduled → publishing is a LOCK: Instagram publishing is not idempotent, two runs = two posts.
//   · A failure spends the approval; it is fixed and approved again, never retried silently.
//
// The file limits are INSTAGRAM's (Content Publishing API), refused here at upload time rather than by
// Meta at 19:00 when nobody is looking.
import { err, ok, type DomainError, type Instant, type Result } from '../../../shared'
import {
  CONTENT_POST_EDITED,
  CONTENT_POST_MEDIA_ATTACHED,
  CONTENT_POST_PUBLISH_APPROVED,
  CONTENT_POST_PUBLISH_FAILED,
  CONTENT_POST_PUBLISH_STARTED,
  CONTENT_POST_PUBLISHED,
  type ContentFormat,
  type ContentPostPublishFailedPayload,
} from '../events'
import { CONTENT_LIMITS, type ContentDecideContext, type Outcome } from './decide'
import type { ContentMedia, ContentPost } from './types'

const APPROVERS: readonly string[] = ['owner', 'platform_admin']
const MB = 1024 * 1024
const VIDEO_TYPES = ['video/mp4', 'video/quicktime']

export const MEDIA_LIMITS = {
  reelsSeconds: [3, 900],
  reelsBytes: 300 * MB,
  storySeconds: [1, 60],
  storyVideoBytes: 100 * MB,
  imageBytes: 8 * MB,
  photoRatio: [0.8, 1.91], // feed photo: 4:5 … 1.91:1
} as const

/** Does this file fit this format, by Instagram's rules? */
export function mediaFits(format: ContentFormat, m: Pick<ContentMedia, 'kind' | 'contentType' | 'bytes' | 'seconds' | 'width' | 'height'>): boolean {
  if (!(m.bytes > 0) || !(m.width > 0) || !(m.height > 0)) return false
  if (m.kind === 'image') {
    if (m.contentType !== 'image/jpeg' || m.bytes > MEDIA_LIMITS.imageBytes) return false
    if (format === 'reels') return false
    if (format === 'photo') {
      const r = m.width / m.height
      return r >= MEDIA_LIMITS.photoRatio[0] && r <= MEDIA_LIMITS.photoRatio[1]
    }
    return true // story
  }
  if (!VIDEO_TYPES.includes(m.contentType) || m.seconds == null) return false
  if (format === 'reels') return m.seconds >= MEDIA_LIMITS.reelsSeconds[0] && m.seconds <= MEDIA_LIMITS.reelsSeconds[1] && m.bytes <= MEDIA_LIMITS.reelsBytes
  if (format === 'story') return m.seconds >= MEDIA_LIMITS.storySeconds[0] && m.seconds <= MEDIA_LIMITS.storySeconds[1] && m.bytes <= MEDIA_LIMITS.storyVideoBytes
  return false // a feed photo post is a photo
}

const base = (ctx: ContentDecideContext, id: string) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'contentPost' as const, id },
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId as never,
})

const ATTACHABLE = new Set(['suggested', 'approved', 'scheduled', 'failed'])

export function decideAttachMedia(
  ctx: ContentDecideContext,
  current: ContentPost,
  media: Omit<ContentMedia, 'uploadedAt' | 'uploadedBy'>,
  aiCheck: ContentPost['aiCheck'],
): Result<Outcome, DomainError> {
  if (!ATTACHABLE.has(current.status)) return err({ code: 'content_not_editable' })
  const m: ContentMedia = { ...media, uploadedAt: ctx.now, uploadedBy: ctx.actor }
  if (!mediaFits(current.format, m)) return err({ code: 'content_invalid', field: 'media' })
  const approvalWithdrawn = current.status === 'scheduled'
  const next: ContentPost = {
    ...current,
    media: m,
    aiCheck: aiCheck ?? null,
    // A scheduled post with a NEW file goes back to the owner; a failed one waits for her approval again.
    status: current.status === 'scheduled' || current.status === 'failed' ? 'approved' : current.status,
    publish: null,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, current.id),
        type: CONTENT_POST_MEDIA_ATTACHED,
        payload: {
          kind: m.kind,
          contentType: m.contentType,
          bytes: m.bytes,
          seconds: m.seconds,
          width: m.width,
          height: m.height,
          replaced: Boolean(current.media),
          approvalWithdrawn,
        },
      },
    ],
  })
}

/** The owner approves THIS file and THIS caption to go out — at its time, or now if that has passed. */
export function decideApprovePublish(ctx: ContentDecideContext, current: ContentPost, consentConfirmed: boolean, opts: { readonly now?: boolean } = {}): Result<Outcome, DomainError> {
  if (!APPROVERS.includes(ctx.role)) return err({ code: 'content_approve_forbidden' })
  // `failed` may be approved again as it is (Meta may have been down); that is a NEW approval.
  if (!['suggested', 'approved', 'scheduled', 'failed'].includes(current.status)) return err({ code: 'content_not_editable' })
  if (!current.media || !mediaFits(current.format, current.media)) return err({ code: 'content_invalid', field: 'media' })
  if (!consentConfirmed) return err({ code: 'content_invalid', field: 'consent' })
  // Caption + hashtags are ONE caption on Instagram, 2.200 characters in all.
  if (publishCaption(current).length > CONTENT_LIMITS.caption) return err({ code: 'content_invalid', field: 'caption' })
  // "Şimdi yayınla" — the owner's own call to skip the planned time.
  const publishAt = (opts.now ? (ctx.now as number) : Math.max(current.scheduledFor as number, ctx.now as number)) as Instant
  const next: ContentPost = {
    ...current,
    status: 'scheduled',
    approvedAt: current.approvedAt ?? ctx.now,
    approvedBy: current.approvedBy ?? ctx.actor,
    consentConfirmed: true,
    publish: { approvedAt: ctx.now, approvedBy: ctx.actor, publishAt, igMediaId: null, permalink: null, publishedAt: null, failure: null },
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, current.id),
        type: CONTENT_POST_PUBLISH_APPROVED,
        payload: { format: current.format, scheduledFor: current.scheduledFor, publishAt, consentConfirmed: true as const },
      },
    ],
  })
}

/** "Onayı geri al" — recorded as an edit that withdrew the approval and changed nothing else. */
export function decideWithdrawPublish(ctx: ContentDecideContext, current: ContentPost): Result<Outcome, DomainError> {
  if (!APPROVERS.includes(ctx.role)) return err({ code: 'content_approve_forbidden' })
  if (current.status !== 'scheduled') return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, status: 'approved', publish: null },
    events: [{ ...base(ctx, current.id), type: CONTENT_POST_EDITED, payload: { changedFields: [], approvalWithdrawn: true } }],
  })
}

/** The lock. Only a scheduled post whose time has come — and only once. */
export function decideStartPublishing(ctx: ContentDecideContext, current: ContentPost): Result<Outcome, DomainError> {
  if (current.status !== 'scheduled' || !current.publish || !current.media) return err({ code: 'operation_not_applicable' })
  if ((current.publish.publishAt as number) > (ctx.now as number)) return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, status: 'publishing', publish: { ...current.publish, startedAt: ctx.now } },
    events: [{ ...base(ctx, current.id), type: CONTENT_POST_PUBLISH_STARTED, payload: {} }],
  })
}

export function decidePublished(ctx: ContentDecideContext, current: ContentPost, ig: { igMediaId: string; permalink: string | null }): Result<Outcome, DomainError> {
  if (current.status !== 'publishing' || !current.publish) return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, status: 'published', publish: { ...current.publish, igMediaId: ig.igMediaId, permalink: ig.permalink, publishedAt: ctx.now, failure: null } },
    events: [{ ...base(ctx, current.id), type: CONTENT_POST_PUBLISHED, payload: { igMediaId: ig.igMediaId } }],
  })
}

export function decidePublishFailed(
  ctx: ContentDecideContext,
  current: ContentPost,
  failure: { stage: ContentPostPublishFailedPayload['stage']; metaCode: string | null; message: string },
): Result<Outcome, DomainError> {
  if (current.status !== 'publishing' || !current.publish) return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, status: 'failed', publish: { ...current.publish, failure: { ...failure, message: failure.message.slice(0, 300) } } },
    events: [{ ...base(ctx, current.id), type: CONTENT_POST_PUBLISH_FAILED, payload: { stage: failure.stage, metaCode: failure.metaCode } }],
  })
}

/** What Instagram receives as the caption: the text, a blank line, the hashtags. */
export function publishCaption(p: Pick<ContentPost, 'caption' | 'hashtags'>): string {
  const tags = p.hashtags.map((h) => `#${h}`).join(' ')
  return [p.caption.trim(), tags].filter(Boolean).join('\n\n')
}

/** Files are kept 90 days after publishing (owner), then deleted; Instagram keeps the post. */
export const MEDIA_RETENTION_DAYS = 90

/** A run that took the lock this long ago and never finished died mid-way (owner sees "check Instagram"). */
export const PUBLISH_STALE_MS = 20 * 60_000
export const isStalePublishing = (p: Pick<ContentPost, 'status' | 'publish'>, now: number): boolean =>
  p.status === 'publishing' && (p.publish?.startedAt as number | undefined) != null && now - (p.publish!.startedAt as number) > PUBLISH_STALE_MS
