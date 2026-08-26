import type { ActorRef, BranchId, CheckInId, Instant, MemberId, StudioId, DeviceId} from '../../../shared'

// Check-in ≠ attendance (Doc 2 §2, §9). `member.checked_in` = walked through the door
// (→ occupancy). It allocates nothing and holds nothing, which is why it is idempotent
// and offline-safe. Identity stays in /members; these carry only opaque ids (I-13).

export type CheckInMethod = 'reception' | 'qr' | 'device' // 'device' unused in Phase 1
export type CheckInDirection = 'in' | 'out'

export interface CheckIn {
  readonly id: CheckInId
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly direction: CheckInDirection
  readonly method: CheckInMethod
  readonly occurredAt: Instant
  readonly actor: ActorRef
}

// Current presence — one doc per member who is inside (id = memberId). Its existence
// IS the in/out toggle state; occupancy is the count of these per branch. Cleared on
// check-out and on the auto-check-out sweep (D4). No PII (I-13).
export interface Presence {
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly checkedInAt: Instant
}

// The branch's occupancy window (D3). Reception opens and closes it; a check-in is
// only allowed while the branch is open.
export interface BranchOccupancy {
  readonly branchId: BranchId
  readonly isOpen: boolean
  readonly openedAt: Instant | null
}

// ── TURNSTILE (v1.33) ────────────────────────────────────────────────────────────────────────
//
// A device bolted to the door. It shows a rotating code on its screen, the member scans it with her
// phone, and the app asks us whether the arm may turn.
//
// The device is a PRINCIPAL, not a borrowed identity (#5): it holds its own id and secret, and the
// check-in it produces carries `actor: { type: 'device' }`. When the log later says the door opened
// at 07:14, it names the door — not whichever receptionist happened to be logged in.
export interface TurnstileDevice {
  readonly id: DeviceId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly name: string // "Giriş turnikesi" — for the panel, never shown to a member
  /**
   * SHA-256 of the device's secret. The secret itself is shown ONCE at pairing and never stored:
   * a device key readable from the database is a key the database's next reader also has.
   */
  readonly secretHash: string
  readonly active: boolean
  /**
   * WHICH SIDE OF THE DOOR THIS SCREEN IS ON (owner, 2026-08-26).
   *
   * The direction used to be inferred from presence: outside ⇒ she must be coming in. That is a
   * guess, and it is wrong exactly when it matters — a member the system still believes is inside
   * scans the ENTRY screen the next morning and is recorded leaving.
   *
   * The studio made exit-scanning mandatory so occupancy would be certain. A guessed direction
   * gives that away. A screen bolted to the entry side is always an entry, and it can simply say so.
   *
   * `null` ⇒ the old behaviour, and it stays supported: a single-screen door has no side to declare,
   * and every device paired before this field existed reads as null rather than as a wrong guess.
   */
  readonly side?: CheckInDirection | null
  /** Last time the device called us at all — the panel's "is it alive" answer. */
  readonly lastSeenAt: Instant | null
  readonly createdAt: Instant
}

/**
 * One code shown on the turnstile's screen.
 *
 * SHORT-LIVED BY DESIGN. The screen is in a public corridor and a photographed code must be worth
 * nothing a minute later — this is the only thing standing between "she scanned the door" and "she
 * was sent a picture of the door". `expiresAt` is enforced in the domain, not by the screen
 * happening to refresh.
 *
 * SINGLE USE. Once a member has crossed on this code the device must show a new one, or two people
 * scan the same photograph and both get in.
 */
export interface TurnstileCode {
  readonly code: string
  readonly deviceId: DeviceId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly issuedAt: Instant
  readonly expiresAt: Instant
  /** The member who spent it, once someone has. */
  readonly usedBy: MemberId | null
  readonly usedAt: Instant | null
}

/**
 * Which way the arm turned.
 *
 * `null` ⇒ the turnstile did not tell us and the direction is inferred from presence (the member is
 * inside ⇒ she is leaving). The wired direction output is better and overrides it: what the arm
 * actually DID beats what we assumed she meant.
 */
export type TurnstileDirection = CheckInDirection | null
