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
  | '/checkin/kiosk' // the self-service wall tablet — a SEPARATE area from the desk check-in screen
  | '/fitness' // Plus Phase 8 — fitness attendance & occupancy (read/report; owner + reception)
  | '/attendance'
  | '/members'
  | '/packages'
  | '/finance' // kasa · gün sonu
  | '/retail' // Ürün Sat — retail sale surface (owner + reception)
  | '/crm'
  | '/calendar'
  | '/operations' // bulk credit ops, closures — they move credits
  | '/advisor' // Plus Phase 10 — AI Insights L1 (owner-confidential decision-support)
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
// The kiosk tablet, plus the desk (reception mounts the same screen on a spare iPad). The kiosk role
// gets THIS area and nothing else — its one screen, and no way to reach a second.
const KIOSK: readonly PrincipalRole[] = ['owner', 'receptionist', 'kiosk']

export const PERMISSIONS: Readonly<Record<Area, readonly PrincipalRole[]>> = {
  // Reception runs the day.
  '/': DESK,
  '/schedule': DESK,
  '/reservations': DESK,
  '/checkin': DESK,
  // The desk screen stays reception's (it shows who is inside and the expected-soon list, by name).
  // The kiosk is a DIFFERENT area: the QR scanner alone, and the only screen the kiosk role may see.
  '/checkin/kiosk': KIOSK,
  // Plus Phase 8 — occupancy & entry reports. Operational (who came, how busy), not private training
  // content, so it is reception's too. A trainer does not get it (it is the studio's usage data).
  '/fitness': DESK,
  '/attendance': DESK,
  '/members': DESK,
  '/packages': DESK,
  '/finance': DESK, // she takes the money, so she counts the till
  '/retail': DESK, // selling a bottle/towel is reception's day, not a config act
  '/crm': DESK,
  '/calendar': DESK,
  '/activity': DESK, // "ben bunu iptal etmiştim" — she needs the record of her own day
  '/notifications': DESK,
  // Reception hands it over, so reception prints it.
  '/receipt': DESK,

  // The owner's alone. Each of these either moves credits, reveals the business, or changes who may
  // work here — and none of them is part of reception's day.
  '/operations': OWNER_ONLY, // bulk credit ops and closures MOVE CREDITS
  // Plus Phase 10 — the advisor reveals the business (who owes, who is about to churn). Owner-first
  // decision-support; reception and trainers have no access.
  '/advisor': OWNER_ONLY,
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

  // The trainer's OWN daily classes — her week, her registers, the names of the women in front of
  // her. It is a PERSONAL screen ("Derslerim"), not a management one, so the admin panel does not
  // carry it: the owner keeps the studio-wide view (Ders Ajandası) here, and sees her own teaching
  // day by signing in with her TRAINER account (owner request, 2026-07-16). Trainer only.
  '/my-classes': ['trainer'],

  // Plus Phase 7 — the training workspace: the exercise library and the feedback center. This is
  // studio-content management (a shared catalogue + cross-member feedback), not a personal "my"
  // screen, so the owner keeps it. Reception is not here: she sees only a boolean "aktif program var
  // mı?" on the member card, never a member's programme or photos.
  '/training': ['owner', 'trainer'],

  // Plus Phase 9 — the trainer's OWN earnings, read-only ("Hakedişim"). A personal screen, so the
  // admin panel does not carry it — the owner sees the studio-wide Bordro here, and her own earnings
  // by signing in with her TRAINER account (owner request, 2026-07-16). Trainer only.
  '/my-payroll': ['trainer'],
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
  if (role === 'trainer') return '/my-classes'
  // The kiosk's only screen IS its home. Signed in on the tablet, it lands on the scanner and can go
  // nowhere else — every other area redirects right back here.
  if (role === 'kiosk') return '/checkin/kiosk'
  return '/'
}
