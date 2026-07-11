import type {
  ActorRef,
  BranchId,
  Category,
  ClassSessionId,
  EntitlementId,
  Instant,
  MemberId,
  ReservationId,
  StudioId,
} from '../../../shared'
import type { MemberSnapshot } from '../../members'

// The reservation aggregate (Doc 2 §7.1, Doc 3 §4.4). Check-in ≠ attendance;
// booking HOLDS a credit, resolution CONSUMES it. `attendanceSource` is null while
// unresolved — it is what separates an observation from a presumption (I-18, AD-38).

export type ReservationStatus =
  | 'booked'
  | 'cancelled'
  | 'late_cancelled'
  | 'attended'
  | 'no_show'
  | 'waitlisted' // enum seam only — nothing produces it in Phase 1 (Doc 2 §7.1)

export type AttendanceSource = 'trainer' | 'system_default' | 'correction'

export type CreditEffect = 'held' | 'consumed' | 'released' | 'none'

export type ReservationPolicyRef = {
  readonly policyId: string
  readonly version: number
}

export type Reservation = {
  readonly id: ReservationId
  readonly studioId: StudioId
  readonly branchId: BranchId
  readonly classSessionId: ClassSessionId
  readonly memberId: MemberId
  readonly entitlementId: EntitlementId

  readonly status: ReservationStatus
  readonly creditEffect: CreditEffect

  // Denormalised from the session — frozen so a dispute reads one row (Doc 3 §4.4).
  readonly sessionStartsAt: Instant
  readonly sessionEndsAt: Instant
  readonly sessionCategory: Category

  // Bounded member snapshot for the roster (OQ-12, AD-44). Never in an event (I-13).
  readonly memberSnapshot: MemberSnapshot

  readonly bookedAt: Instant
  readonly bookedBy: ActorRef
  readonly resolvedAt: Instant | null
  readonly resolvedBy: ActorRef | null
  readonly attendanceSource: AttendanceSource | null

  readonly policyRef: ReservationPolicyRef // the cancellation rules AT BOOKING TIME (D3)
  readonly note?: ReservationNote | null // the staff quick note (Hızlı Not); optional/additive
}

// The reservation quick note (Hızlı Not) — STAFF-ONLY (never shown to the member,
// unlike the class note). Free text kept intact for staff and, later, AI. EXTENSIBLE:
// future optional fields (attachments, links, aiSuggestion) are additive and versioned,
// so adding one never breaks the model.
export interface ReservationNote {
  readonly text: string
  readonly setAt: Instant
  // future (do not build yet): attachments?, links?, aiSuggestion? — all additive.
}
