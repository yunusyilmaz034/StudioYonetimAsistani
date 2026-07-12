import type {
  ActorRef,
  BranchId,
  ClassSessionId,
  Instant,
  MemberId,
  ReservationId,
  StudioId,
} from '../../../shared'
import type { MemberSnapshot } from '../../members'

// ── D20 — the waiting list (v1.22). ─────────────────────────────────────────────────────────
//
// **I-29 — a waitlist entry holds no credit.** Waiting is not booking. If waiting held a credit,
// a member could sit on three lists and lose three credits for classes she never attended, and
// the ledger would be lying about what she is owed. She holds nothing until she is promoted, and
// promotion is an ordinary booking with an ordinary hold.
//
// **No auto-promotion in v1.22 (owner).** A seat opening does NOT silently book the next person.
// Without a notification channel, an auto-promoted member would not know she is booked — and with
// presumed attendance (DEBT-007) the class would then CONSUME her credit for a lesson she never
// heard about. Reception promotes, deliberately, and the member is told. The FIFO order is
// recorded so that decision has an obvious right answer.

export type WaitlistStatus =
  | 'waiting'
  | 'promoted' // became a real reservation
  | 'left' // she withdrew, or reception removed her
  | 'expired' // the class started and she was never promoted

export interface WaitlistEntry {
  readonly id: string
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly classSessionId: ClassSessionId
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot // the roster read; never in an event (I-13)
  readonly status: WaitlistStatus
  readonly joinedAt: Instant // FIFO is decided by this, and by nothing else
  readonly joinedBy: ActorRef
  readonly resolvedAt: Instant | null
  readonly reservationId: ReservationId | null // set when promoted
}

// FIFO — earliest join first; the id breaks a tie deterministically (two joins in the same
// millisecond must still have ONE right answer).
export const byQueueOrder = (a: WaitlistEntry, b: WaitlistEntry): number =>
  a.joinedAt !== b.joinedAt ? a.joinedAt - b.joinedAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
