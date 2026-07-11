import type { ActorRef, BranchId, CheckInId, Instant, MemberId, StudioId } from '../../../shared'

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
