import {
  newReservationId,
  ok,
  type ClassSessionId,
  type DomainError,
  type EntitlementId,
  type MemberId,
  type Result,
  type ReservationId,
  type TenantContext,
} from '../../../shared'
import { decideHold } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import { decideBooking } from '../domain/decide'
import { decideContext } from './context'
import type { BookDecision, ReservationsDeps } from './ports'

export interface BookReservationInput {
  readonly sessionId: ClassSessionId
  // Reception may override the auto-selection; the Server Action runs
  // selectEntitlement (I-17) and passes the chosen entitlement here.
  readonly entitlementId: EntitlementId
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot
}

// Booking = a synchronous, trusted Server-Action write (AD-35): it allocates a
// scarce seat and holds a credit, so it is never a /commands write. The transaction
// (I-10) reads session + entitlement, composes decideBooking with the credit-ledger
// hold (AD-53), and writes reservation + bookedCount + entitlement + events atomically.
export async function bookReservation(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: BookReservationInput,
): Promise<Result<{ reservationId: ReservationId }, DomainError>> {
  const dctx = decideContext(deps, ctx)
  const reservationId = newReservationId()

  return deps.repo.book(ctx, {
    sessionId: input.sessionId,
    entitlementId: input.entitlementId,
    memberId: input.memberId,
    decide: (session, entitlement, memberHasBooked): Result<BookDecision, DomainError> => {
      const booked = decideBooking(
        dctx,
        session,
        entitlement,
        { reservationId, memberId: input.memberId, memberSnapshot: input.memberSnapshot },
        memberHasBooked,
      )
      if (!booked.ok) return booked

      // Period entitlements hold nothing; credit entitlements hold one (E1).
      if (entitlement.credits === null) {
        return ok({
          reservation: booked.value.reservation,
          nextEntitlement: entitlement,
          bookedCountAfter: session.bookedCount + 1,
          events: booked.value.events,
        })
      }
      const hold = decideHold(dctx, entitlement, reservationId)
      if (!hold.ok) return hold
      return ok({
        reservation: booked.value.reservation,
        nextEntitlement: hold.value.next,
        bookedCountAfter: session.bookedCount + 1,
        events: [...booked.value.events, ...hold.value.events],
      })
    },
  })
}
