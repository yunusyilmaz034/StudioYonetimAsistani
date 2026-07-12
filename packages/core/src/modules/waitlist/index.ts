// The waiting list's only public door (D20, v1.22). It owns I-29: a waitlist entry NEVER holds a
// credit. Promotion is a manual act by staff, and it books through the reservations module — this
// module never touches the ledger itself.
export type { WaitlistEntry, WaitlistStatus } from './domain/types'
export { byQueueOrder } from './domain/types'
export * from './events'
// `DecideContext` stays internal: three modules already export a structurally identical one, and
// a fourth in the barrel is an ambiguity, not a capability.
export { decideJoin, decideLeave, decidePromote } from './domain/decide'
export {
  joinWaitlist,
  leaveWaitlist,
  nextInQueue,
  promoteFromWaitlist,
  type PromoteDeps,
  type WaitlistJoinInput,
} from './application/waitlist'
export type { WaitlistDeps, WaitlistRepository } from './application/ports'
export { FirestoreWaitlistRepository } from './infrastructure/repos'
