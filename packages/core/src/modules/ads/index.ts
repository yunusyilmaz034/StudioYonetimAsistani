// The ads module's public door (IG-5a, 2026-11-04) — paid campaigns: proposed (AI or staff), approved by
// the owner, published to Meta. MONEY: read README.md first.
export type { AdCampaign, AdCampaignFields, AdCampaignStatus, AdChangeKind, AdChangeRequest, AdCreative, AdTargeting } from './domain/types'
export { decideChange, decideChangeApplied, decideChangeFailed, decideDismissChange, decideRequestChange, pendingAsChange, previewChange, type AdChange } from './domain/changes'
export * from './events'
export {
  AD_LIMITS,
  campaignDays,
  dayAfterEnd,
  decideApproveCampaign,
  decideEditCampaign,
  decideProposeCampaign,
  decidePublished,
  decidePublishFailed,
  decideRemoveCampaign,
  decideStartPublishing,
  maxSpend,
  validateAdFields,
  type AdDecideContext,
} from './domain/decide'
export {
  approveAndLockAdCampaign,
  commitAdChangeApplied,
  commitAdChangeFailed,
  dismissAdChange,
  prepareAdChange,
  requestAdChange,
  type PreparedAdChange,
  editAdCampaign,
  markAdCampaignFailed,
  markAdCampaignPublished,
  proposeAdCampaign,
  removeAdCampaign,
  type AdsDeps,
} from './application'
export { FirestoreAdsRepository } from './infrastructure/repos'
