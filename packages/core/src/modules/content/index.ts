// The content module's public door (IG-2a, 2026-11-03) — the studio's Instagram plan: what to post,
// how to film it, what to write under it. Nothing here publishes (that is IG-2b, behind an approval
// event). Read README.md first.
export type { ContentPost, ContentPostFields, ContentStatus, ShotCard, ShotClip } from './domain/types'
export * from './events'
export {
  CONTENT_LIMITS,
  decideApprovePost,
  decideEditPost,
  decidePlanPost,
  decideRemovePost,
  istanbulWeekStart,
  validateContentFields,
  type ContentDecideContext,
} from './domain/decide'
export type { ContentDeps, ContentRepository } from './application/ports'
export { approveContentPost, editContentPost, planContentPosts, removeContentPost } from './application'
export { FirestoreContentRepository } from './infrastructure/repos'
