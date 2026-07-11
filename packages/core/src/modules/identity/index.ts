// The identity module's only public door (AD-29). Read-only in Phase 1: a staff /
// trainer list for the scheduling pickers. Staff creation with events is a later
// milestone; nothing here mutates state.
export type { StaffMember } from './domain/types'
export type { IdentityDeps, IdentityRepository } from './application/ports'
export { FirestoreIdentityRepository } from './infrastructure/repos'
