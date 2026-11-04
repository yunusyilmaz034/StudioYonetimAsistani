// IG-3 (2026-11-04, owner approved) — Instagram comments on the studio's posts.
// NO TEXT, NO USERNAME in any payload (#6): the comment and the reply live on the comment document
// only. The log keeps what happened: which post, what kind of comment, who handled it, how.
import type { Instant } from '../../shared'

export const IG_COMMENT_RECEIVED = 'ig_comment.received'
export const IG_COMMENT_REPLIED = 'ig_comment.replied'
export const IG_COMMENT_HIDDEN = 'ig_comment.hidden'
export const IG_COMMENT_DISMISSED = 'ig_comment.dismissed'

export type CommentCategory = 'question' | 'praise' | 'complaint' | 'spam' | 'other'

export interface IgCommentReceivedPayload {
  readonly mediaId: string
  readonly category: CommentCategory
  readonly commentedAt: Instant
  readonly open: boolean // false = older than the first-run window, closed on arrival
}

export interface IgCommentRepliedPayload {
  readonly category: CommentCategory
  readonly edited: boolean // the AI's draft was changed before sending
  readonly hadDraft: boolean
}

export interface IgCommentHiddenPayload {
  readonly category: CommentCategory
}

export interface IgCommentDismissedPayload {
  readonly category: CommentCategory
}
