// The CRM module's only public door (v1.24, Doc 26 §8).
//
// A LEAD IS NOT A MEMBER (owner, decision 6): conversion is an explicit act that produces a member
// and closes the lead. Merging them would put a `status !== 'lead'` filter on every member query in
// the product, forever.
//
// No PII in the log (#6): a lead's name and phone live in /leads; the event carries her SOURCE,
// which is the analysable part — and the part that must survive her erasure.
export type {
  ChurnReason,
  Interaction,
  InteractionKind,
  Lead,
  LeadSource,
  LeadStage,
  LostReason,
  Offer,
  OfferLine,
  OfferStatus,
} from './domain/types'
export { offerTotal } from './domain/types'
export * from './events'
export {
  decideAcceptOffer,
  decideCaptureLead,
  decideChurn,
  decideConvertLead,
  decideCreateOffer,
  decideLogInteraction,
  decideLoseLead,
  decideMoveStage,
  decideRejectOffer,
  decideSendOffer,
} from './domain/decide'
export type { CrmDeps, CrmRepository } from './application/ports'
export { FirestoreCrmRepository } from './infrastructure/repos'
