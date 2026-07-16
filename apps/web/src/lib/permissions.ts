import type { PrincipalRole } from '@studio/core'

// THE PERMISSION MATRIX (owner, 2026-07-13 · v1.27 S1).
//
// One table, in one file, read by everything: the navigation, the page guards, and the tests. A
// matrix written down in three places is a matrix that is wrong in three different ways — and the
// way you find out is a trainer opening the kasa.
//
// ── What this is, and what it is NOT ────────────────────────────────────────────────────────
// This gates SCREENS. It is not the write authorization: every Server Action that mutates state
// still calls `requireTenantContext([...])` with its own allow-list, and that is the door that
// actually holds. This is the door that stops a trainer *seeing* the members list — a real gap
// until now, because every staff page asked "are you staff?" and none asked "which role?".
//
// ── The rule that shapes the trainer's row ──────────────────────────────────────────────────
// A trainer is staff, and she is also the person least entitled to the studio's data. She needs her
// own classes and the names of the women in them. She does not need the members list, the till, the
// funnel, or another trainer's roster. So her row is not "reception minus a few things"; it is a
// single screen built for her.

/** Every gated area of the staff app. The key IS the route. */
export type Area =
  | '/' // the owner/reception dashboard
  | '/schedule'
  | '/reservations'
  | '/checkin'
  | '/fitness' // Plus Phase 8 — fitness attendance & occupancy (read/report; owner + reception)
  | '/attendance'
  | '/members'
  | '/packages'
  | '/finance' // kasa · gün sonu
  | '/crm'
  | '/calendar'
  | '/operations' // bulk credit ops, closures — they move credits
  | '/activity'
  | '/notifications'
  | '/analytics'
  | '/audit'
  | '/settings' // S2
  | '/staff' // S1 — who may work here, and as what
  | '/my-classes' // the trainer's one screen
  | '/training' // Plus Phase 7 — exercise library + feedback center (owner + trainer)
  | '/payroll' // Plus Phase 9 — trainer payroll & commission (owner-confidential)
  | '/my-payroll' // Plus Phase 9 — the trainer's own earnings, read-only (owner + trainer)
  | '/receipt' // the printable slip reception hands a member
  | '/import' // S5 — the BulutGym import
  | '/reports' // S6 — the seven reports

const OWNER_ONLY: readonly PrincipalRole[] = ['owner']
const DESK: readonly PrincipalRole[] = ['owner', 'receptionist']

export const PERMISSIONS: Readonly<Record<Area, readonly PrincipalRole[]>> = {
  // Reception runs the day.
  '/': DESK,
  '/schedule': DESK,
  '/reservations': DESK,
  '/checkin': DESK,
  // Plus Phase 8 — occupancy & entry reports. Operational (who came, how busy), not private training
  // content, so it is reception's too. A trainer does not get it (it is the studio's usage data).
  '/fitness': DESK,
  '/attendance': DESK,
  '/members': DESK,
  '/packages': DESK,
  '/finance': DESK, // she takes the money, so she counts the till
  '/crm': DESK,
  '/calendar': DESK,
  '/activity': DESK, // "ben bunu iptal etmiştim" — she needs the record of her own day
  '/notifications': DESK,
  // Reception hands it over, so reception prints it.
  '/receipt': DESK,

  // The owner's alone. Each of these either moves credits, reveals the business, or changes who may
  // work here — and none of them is part of reception's day.
  '/operations': OWNER_ONLY, // bulk credit ops and closures MOVE CREDITS
  '/analytics': OWNER_ONLY,
  '/audit': OWNER_ONLY,
  '/settings': OWNER_ONLY,
  '/staff': OWNER_ONLY,
  // Plus Phase 9 — payroll is the business's cost side. Owner-confidential; reception never, a
  // trainer never sees another trainer (she gets /my-payroll instead).
  '/payroll': OWNER_ONLY,
  // It writes forty-five member records in one press. That belongs to the owner.
  '/import': OWNER_ONLY,
  // Reports are the business, in a file, on a laptop (owner, 2026-07-13: reception does not get
  // finance reports, and bulk export is the owner's alone). The structural export test already
  // enforces the second half of that sentence.
  '/reports': OWNER_ONLY,

  // The trainer's ONLY screen. Her classes, her week, her registers, and the names of the women in
  // front of her. Not a phone number, not a package, not a balance.
  '/my-classes': ['owner', 'trainer'], // the owner may look at it; nobody else may

  // Plus Phase 7 — the training workspace: the exercise library and the feedback center. It is the
  // trainer's OTHER screen (her actual craft), and the owner's. Reception is not here: she sees only
  // a boolean "aktif program var mı?" on the member card, never a member's programme or photos.
  '/training': ['owner', 'trainer'],

  // Plus Phase 9 — the trainer's own earnings, read-only. She sees her breakdown and status, never a
  // rate control, never another trainer. The owner may look; reception may not.
  '/my-payroll': ['owner', 'trainer'],
}

export function canSee(role: PrincipalRole, area: Area): boolean {
  return PERMISSIONS[area].includes(role)
}

/**
 * Where a principal lands when she signs in.
 *
 * A trainer sent to `/` would hit the owner dashboard — which she may not see — and bounce. Her home
 * is her own screen, and it is the only one she has.
 */
export function homeFor(role: PrincipalRole): string {
  return role === 'trainer' ? '/my-classes' : '/'
}
