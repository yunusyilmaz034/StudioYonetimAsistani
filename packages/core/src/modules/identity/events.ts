import type { StaffRole } from '../../shared'

// Staff — who may work here, and as what (v1.27 S1 · owner, 2026-07-13).
//
// Until now the `identity` module was READ-ONLY: a list of names to hang on a class. Staff accounts
// existed only because a seed script put them in the emulator, which meant that on a fresh
// production project **nobody could log in at all** — and that no second receptionist could ever be
// added without a developer.
//
// ── Why these are events at all ─────────────────────────────────────────────────────────────
// Because they are the most consequential writes in the system that touch no money. Granting
// somebody the receptionist role hands her every member's phone number and the key to the till;
// changing a role is the quietest possible way to widen access, and a role that changed with no
// record is a role nobody can explain. The audit answers *who could do what, when* — and it can only
// answer that if the change was written down at the moment it happened.
//
// ── No PII, as everywhere else (#6) ─────────────────────────────────────────────────────────
// A staff member's NAME and e-mail are PII, and they never enter a payload. They live on the
// `/staff` document, which is where an erasure would reach them. What the log records is the opaque
// user id and the ROLE — which is the analysable part, and the part that must survive her leaving.
export const STAFF_CREATED = 'staff.created'
export const STAFF_ROLE_CHANGED = 'staff.role_changed'
export const STAFF_DEACTIVATED = 'staff.deactivated'
export const STAFF_REACTIVATED = 'staff.reactivated'

export type StaffCreatedPayload = {
  readonly staffUserId: string
  readonly role: StaffRole
}

// `from` and `to`, both — a role change is only legible if you can see what it changed FROM. "Ayşe
// became a receptionist" tells you nothing about whether that was a promotion or a demotion.
export type StaffRoleChangedPayload = {
  readonly staffUserId: string
  readonly from: StaffRole
  readonly to: StaffRole
}

export type StaffDeactivatedPayload = {
  readonly staffUserId: string
  readonly reason: string
}

export type StaffReactivatedPayload = {
  readonly staffUserId: string
}
