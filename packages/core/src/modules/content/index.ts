// The content module's public door (IG-2a, 2026-11-03) — the studio's Instagram plan: what to post,
// how to film it, what to write under it. Nothing here publishes (that is IG-2b, behind an approval
// event). Read README.md first.
export type {
  ContentAiCheck,
  ContentEditOverrides,
  ContentEditPlan,
  ContentEditState,
  ContentMedia,
  ContentPost,
  ContentPostFields,
  ContentPublishState,
  ContentRawClip,
  ContentStatus,
  EditSegment,
  MusicTrack,
  ShotCard,
  ShotClip,
  SubtitleLine,
} from './domain/types'
export {
  applyEditOverrides,
  decideAddRawClip,
  decideEditFailed,
  decideEditRendered,
  decideRequestEdit,
  EDIT_LIMITS,
  EDIT_STALE_MS,
  isEditRendering,
  isEditStale,
  lineId,
  normalizeEditPlan,
  type AiEditProposal,
  type TranscriptLine,
} from './domain/edit'
export {
  decideApprovePublish,
  decideAttachMedia,
  decidePublished as decideContentPublished,
  decidePublishFailed as decideContentPublishFailed,
  decideStartPublishing as decideContentStartPublishing,
  decideWithdrawPublish,
  isStalePublishing,
  MEDIA_LIMITS,
  MEDIA_RETENTION_DAYS,
  mediaFits,
  publishCaption,
} from './domain/publish'
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
export {
  addContentRawClip,
  approveContentPost,
  approveContentPublish,
  completeContentEdit,
  failContentEdit,
  requestContentEdit,
  attachContentMedia,
  editContentPost,
  markContentPublished,
  markContentPublishFailed,
  planContentPosts,
  removeContentPost,
  startContentPublishing,
  withdrawContentPublish,
} from './application'
export { FirestoreContentRepository } from './infrastructure/repos'
