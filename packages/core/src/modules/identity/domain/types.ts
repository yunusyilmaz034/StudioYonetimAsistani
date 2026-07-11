import type { StaffRole, StaffUserId } from '../../../shared'

// A staff principal, as the scheduling pickers need to name one (assign/change a
// session's trainer). Phase 1 is read-only: staff exist as auth principals with
// custom claims plus a `/staff` document; creation-with-events is a later milestone.
// Any active staff member may be a session's trainer (a small studio's owner teaches).
export interface StaffMember {
  readonly id: StaffUserId
  readonly displayName: string
  readonly role: StaffRole
  readonly active: boolean
}
