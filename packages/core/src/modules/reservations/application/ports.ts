import type {
  ClassSessionId,
  Clock,
  DomainError,
  EntitlementId,
  Instant,
  MemberId,
  NewEvent,
  ReservationId,
  Result,
  TenantContext,
} from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { ClassSession } from '../../scheduling'
import type { Reservation } from '../domain/types'

// The booking and cancellation transactions span three aggregates (reservation,
// class session, entitlement). Firestore requires all reads before any write, in one
// transaction (I-10). The repo runs the transaction and reads the fresh state; the
// pure `decide` callback — supplied by the application — composes the reservation and
// credit-ledger deciders on that state (AD-53). The repo holds NO domain logic.

export interface BookDecision {
  readonly reservation: Reservation
  readonly nextEntitlement: Entitlement
  readonly bookedCountAfter: number
  readonly events: readonly NewEvent[]
}

export interface BookTxInput {
  readonly sessionId: ClassSessionId
  readonly entitlementId: EntitlementId
  readonly memberId: MemberId
  readonly decide: (
    session: ClassSession,
    entitlement: Entitlement,
    memberHasBooked: boolean,
  ) => Result<BookDecision, DomainError>
}

export interface CancelDecision {
  readonly reservation: Reservation
  readonly nextEntitlement: Entitlement | null // null ⇔ period entitlement, no ledger write
  readonly bookedCountAfter: number
  readonly events: readonly NewEvent[]
}

export interface CancelTxInput {
  readonly reservationId: ReservationId
  readonly decide: (reservation: Reservation, session: ClassSession, entitlement: Entitlement) => Result<CancelDecision, DomainError>
}

// Resolution (attendance marking, auto-resolution, correction) spans the
// reservation and its entitlement — never the session's seat count: a resolved
// booking still happened, so `bookedCount` is untouched (only cancel frees a seat).
// The application supplies the pure `decide` callback composing the reservation
// decider with the matching ledger movement (AD-53/AD-55).
export interface ResolveDecision {
  readonly reservation: Reservation
  readonly nextEntitlement: Entitlement | null // null ⇔ period entitlement, no ledger write
  readonly events: readonly NewEvent[]
}

export interface ResolveTxInput {
  readonly reservationId: ReservationId
  readonly decide: (
    reservation: Reservation,
    session: ClassSession,
    entitlement: Entitlement,
  ) => Result<ResolveDecision, DomainError>
}

export interface ReservationRepository {
  getReservation(ctx: TenantContext, id: ReservationId): Promise<Reservation | null>
  book(ctx: TenantContext, input: BookTxInput): Promise<Result<{ reservationId: ReservationId }, DomainError>>
  cancel(ctx: TenantContext, input: CancelTxInput): Promise<Result<void, DomainError>>
  resolve(ctx: TenantContext, input: ResolveTxInput): Promise<Result<void, DomainError>>
  // The auto-resolution sweep's candidate set: still-`booked` reservations whose
  // session has ended. The transaction re-reads and `decideAutoResolution`
  // re-validates the grace window, so this coarse cut may return a not-yet-eligible
  // row without harm.
  listResolvableBooked(ctx: TenantContext, endedAtOrBefore: Instant): Promise<readonly Reservation[]>
  // The attendance roster read: a day's reservations by denormalised `sessionStartsAt`.
  listBySessionStartRange(
    ctx: TenantContext,
    fromInclusive: Instant,
    toExclusive: Instant,
  ): Promise<readonly Reservation[]>
  // The booking roster read: every reservation for one session (any status).
  listBySession(ctx: TenantContext, classSessionId: ClassSessionId): Promise<readonly Reservation[]>
}

export interface ReservationsDeps {
  readonly repo: ReservationRepository
  readonly clock: Clock
}
