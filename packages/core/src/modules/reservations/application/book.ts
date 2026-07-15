import {
  newReservationId,
  ok,
  type ClassSessionId,
  type DomainError,
  isOverrideActiveAt,
  type EntitlementId,
  type MemberId,
  type OperationId,
  type ReservationOverride,
  type Result,
  type ReservationId,
  type TenantContext,
} from '../../../shared'
import { decideHold } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import { decideBooking } from '../domain/decide'
import { localMinuteOfDay, localWeekday, packageRuleFromSnapshot, resolveReservationPolicy } from '../domain/policy'
import { decideContext } from './context'
import type { BookDecision, ReservationsDeps } from './ports'

const DAY_MS = 86_400_000
const localDayNumber = (ms: number, offsetMinutes: number): number =>
  Math.floor((ms + offsetMinutes * 60_000) / DAY_MS)

export interface BookReservationInput {
  readonly sessionId: ClassSessionId
  // Reception may override the auto-selection; the Server Action runs
  // selectEntitlement (I-17) and passes the chosen entitlement here.
  readonly entitlementId: EntitlementId
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot
  // OP-2 — set when this booking belongs to a larger operation (a promotion from the waiting
  // list, a recurring series). Omitted for a stand-alone booking.
  readonly operationId?: OperationId
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
  const dctx = decideContext(deps, ctx, input.operationId ? { operationId: input.operationId } : {})
  const reservationId = newReservationId()
  // AG-1 — read ONCE, outside the transaction. Opening hours are a studio-wide setting that changes
  // a few times a year; re-reading them inside every booking transaction would buy nothing and cost
  // a document read on the hottest path in the product.
  const hours = await deps.hours.getStudioHours(ctx)
  const offset = hours.utcOffsetMinutes

  // Package Rules 2.0 — resolve the member's override and count her open reservations ONCE, before the
  // transaction (both change rarely; a soft limit does not need the hold's atomicity). The counts use
  // the reservation's own denormalised `sessionStartsAt`, so no session read is needed here.
  // Plus Phase 4 — an override outside its validity window is INERT: the member falls back to the
  // package rules automatically, no sweep required.
  const raw = deps.policy ? await deps.policy.getMemberOverride(ctx, input.memberId) : null
  const override: ReservationOverride | null = raw && isOverrideActiveAt(raw, dctx.now) ? raw : null
  const openStarts = (await deps.repo.listByMember(ctx, input.memberId))
    .filter((r) => r.status === 'booked')
    .map((r) => r.sessionStartsAt as number)

  return deps.repo.book(ctx, {
    sessionId: input.sessionId,
    entitlementId: input.entitlementId,
    memberId: input.memberId,
    decide: (session, entitlement, memberHasBooked): Result<BookDecision, DomainError> => {
      const eff = resolveReservationPolicy(packageRuleFromSnapshot(entitlement.productSnapshot), override)
      const sessionDay = localDayNumber(session.startsAt, offset)
      const booked = decideBooking(
        dctx,
        session,
        entitlement,
        { reservationId, memberId: input.memberId, memberSnapshot: input.memberSnapshot },
        memberHasBooked,
        hours,
        {
          policy: eff,
          sessionWeekday: localWeekday(session.startsAt, offset),
          sessionStartMinutes: localMinuteOfDay(session.startsAt, offset),
          memberDayReservationCount: openStarts.filter((s) => localDayNumber(s, offset) === sessionDay).length,
          memberActiveReservationCount: openStarts.length,
        },
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
