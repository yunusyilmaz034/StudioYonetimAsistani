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
