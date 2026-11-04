// The Instagram content plan (IG-2a, 2026-11-03). NEW event types — nothing existing is touched.
//
// What the log records is the LIFECYCLE of a post — planned, edited, approved, removed — so IG-4 can
// later ask "which post brought members?" against facts that were never rewritten. What it does NOT
// record is the text: title, shot card and caption live on the state document. They are marketing
// copy, not PII, but a member's first name can end up in a caption ("Ayşe'nin ilk dersi"), and the
// rule is simpler to keep than to argue case by case (#6): no free text in a content event.
import type { Instant } from '../../shared'

export const CONTENT_POST_PLANNED = 'content_post.planned'
export const CONTENT_POST_EDITED = 'content_post.edited'
export const CONTENT_POST_APPROVED = 'content_post.approved'
export const CONTENT_POST_REMOVED = 'content_post.removed'

export type ContentFormat = 'reels' | 'photo' | 'story'
export type ContentOrigin = 'ai' | 'staff'

export interface ContentPostPlannedPayload {
  readonly format: ContentFormat
  readonly origin: ContentOrigin
  readonly weekStart: string // 'YYYY-MM-DD', the Monday of the plan's week (Europe/Istanbul)
  readonly scheduledFor: Instant
  readonly clipCount: number
}

export interface ContentPostEditedPayload {
  readonly changedFields: readonly string[]
  // An edit after approval withdraws it: the owner approved THAT text, not this one (OR-131).
  readonly approvalWithdrawn: boolean
}

export interface ContentPostApprovedPayload {
  readonly format: ContentFormat
  readonly scheduledFor: Instant
  // "Everyone visible has agreed" (owner, 2026-11-03 — the per-post consent box). Recorded with the
  // approval it belongs to; WHO was visible is never recorded.
  readonly consentConfirmed: boolean
}

export interface ContentPostRemovedPayload {
  readonly wasApproved: boolean
}

// IG-2b (2026-11-04, owner approved) — the filmed file, the owner's publish approval, and the outcome.
// Same rule as above: no caption, no file name, no Meta error text — sizes, times and ids only.
// `publish_started` is the lock (as `ad_campaign.publish_started`): Instagram publishing is NOT
// idempotent — two presses would be two posts — so taking the lock is a state change, logged.
export const CONTENT_POST_MEDIA_ATTACHED = 'content_post.media_attached'
export const CONTENT_POST_PUBLISH_APPROVED = 'content_post.publish_approved'
export const CONTENT_POST_PUBLISH_STARTED = 'content_post.publish_started'
export const CONTENT_POST_PUBLISHED = 'content_post.published'
export const CONTENT_POST_PUBLISH_FAILED = 'content_post.publish_failed'

export interface ContentPostMediaAttachedPayload {
  readonly kind: 'video' | 'image'
  readonly contentType: string
  readonly bytes: number
  readonly seconds: number | null
  readonly width: number
  readonly height: number
  readonly replaced: boolean // a file was already there
  readonly approvalWithdrawn: boolean // the owner approved THAT file, not this one
}

export interface ContentPostPublishApprovedPayload {
  readonly format: ContentFormat
  readonly scheduledFor: Instant
  readonly publishAt: Instant
  readonly consentConfirmed: true
}

export type ContentPostPublishStartedPayload = Record<string, never>

export interface ContentPostPublishedPayload {
  readonly igMediaId: string
}

export interface ContentPostPublishFailedPayload {
  readonly stage: 'media_url' | 'container' | 'processing' | 'publish' | 'unknown'
  readonly metaCode: string | null
}

// IG-2c (2026-11-04, owner approved) — the AI edit. Raw clips are uploaded, an edit is requested, the
// server renders it. A finished render is an ordinary `media_attached` (the file is what it is).
// Again no text: no transcript, no hook, no file name — counts, sizes and stages only.
export const CONTENT_POST_RAW_CLIP_ADDED = 'content_post.raw_clip_added'
export const CONTENT_POST_EDIT_REQUESTED = 'content_post.edit_requested'
export const CONTENT_POST_EDIT_FAILED = 'content_post.edit_failed'

export interface ContentPostRawClipAddedPayload {
  readonly slot: number
  readonly contentType: string
  readonly bytes: number
  readonly seconds: number
  readonly width: number
  readonly height: number
  readonly replaced: boolean // a clip was already in this slot
  readonly clipCount: number
}

export interface ContentPostEditRequestedPayload {
  readonly clipCount: number
  readonly redo: boolean // a re-render with a person's changes (cuts kept)
  readonly subtitles: boolean | null // null = the AI decides (first edit)
  readonly approvalWithdrawn: boolean
}

export interface ContentPostEditFailedPayload {
  readonly stage: 'download' | 'transcribe' | 'plan' | 'render' | 'upload' | 'unknown'
}
