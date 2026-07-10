import type {
  ClassSessionId,
  Clock,
  DomainError,
  EntitlementId,
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

export interface ReservationRepository {
  getReservation(ctx: TenantContext, id: ReservationId): Promise<Reservation | null>
  book(ctx: TenantContext, input: BookTxInput): Promise<Result<{ reservationId: ReservationId }, DomainError>>
  cancel(ctx: TenantContext, input: CancelTxInput): Promise<Result<void, DomainError>>
}

export interface ReservationsDeps {
  readonly repo: ReservationRepository
  readonly clock: Clock
}
