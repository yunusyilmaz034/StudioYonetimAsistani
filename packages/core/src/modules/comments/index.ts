// The comments module's public door (IG-3, 2026-11-04) — Instagram comments on the studio's posts:
// AI sorts and drafts, a person replies, complaints are the owner's. Read README.md first.
export * from './events'
export type { CommentStatus, IgComment } from './domain/types'
export {
  checkHide,
  checkReply,
  COMMENT_LIMITS,
  containsPrice,
  decideDismiss,
  decideHidden,
  decideReceiveComment,
  decideReplied,
  mayReply,
  withFailure,
  type CommentDecideContext,
} from './domain/decide'
export { dismissIgComment, hideIgComment, receiveIgComment, replyToIgComment, type CommentDeps, type CommentRepository } from './application'
export { FirestoreCommentRepository } from './infrastructure/repos'
