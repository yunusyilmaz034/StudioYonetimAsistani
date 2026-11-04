import type { ActorRef, Instant, StudioId } from '../../../shared'
import type { CommentCategory } from '../events'

// `open` → replied | hidden | dismissed. `closed` = arrived older than the first-run window: history,
// not work.
export type CommentStatus = 'open' | 'replied' | 'hidden' | 'dismissed' | 'closed'

/** One top-level comment on one of the studio's Instagram posts. `id` is Instagram's comment id. */
export interface IgComment {
  readonly id: string
  readonly studioId: StudioId
  readonly mediaId: string
  readonly mediaLabel: string // the post's caption, first words — to say which post
  readonly mediaPermalink: string | null
  readonly username: string
  readonly text: string
  readonly commentedAt: Instant
  readonly category: CommentCategory
  readonly draft: string | null // the AI's suggested reply; null for spam / when the AI could not
  readonly status: CommentStatus
  readonly receivedAt: Instant
  readonly handledAt: Instant | null
  readonly handledBy: ActorRef | null
  readonly reply: { readonly text: string; readonly igReplyId: string; readonly edited: boolean } | null
  readonly lastFailure: { readonly message: string; readonly at: Instant } | null
}
