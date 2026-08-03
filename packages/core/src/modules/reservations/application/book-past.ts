import {
  newReservationId,
  ok,
  type ClassSessionId,
  type DomainError,
  type EntitlementId,
  type Instant,
  type MemberId,
  type Result,
  type ReservationId,
  type TenantContext,
} from '../../../shared'
import { decideConsume, decideHold } from '../../entitlements'
import type { MemberSnapshot } from '../../members'
import { decideAttendance, decideBooking } from '../domain/decide'
import { decideContext } from './context'
import type { BookDecision, ReservationsDeps } from './ports'

export interface BookPastAttendedInput {
  readonly sessionId: ClassSessionId
  readonly entitlementId: EntitlementId
  readonly memberId: MemberId
  readonly memberSnapshot: MemberSnapshot
  /** How far back this may reach — policy, resolved by the caller (the domain knows no numbers). */
  readonly earliest: Instant
}

/**
 * GEÇMİŞ DERSE ÜYE EKLEME (owner, 2026-08-02).
 *
 * *"Üye bugün kimseye sormadan çıkmış gelmiş, biz derste yer vardı aldık ama sistemin bundan haberi
 * yok, dolayısıyla kadının kredisi düşmedi."* The class happened, the seat was really taken, and the
 * ledger says otherwise — which means the studio gave away a class it was owed.
 *
 * ONE transaction writes what actually happened, in the order it happened:
 *
 *   reservation.booked      → the credit is HELD
 *   entitlement.credit_held
 *   reservation.attended    → the hold becomes CONSUMED
 *   entitlement.credit_consumed
 *
 * Both halves or neither. A booking without its attendance would leave a credit held against a class
 * that is over and can never resolve — the ledger would be wrong in a new way instead of the old one.
 *
 * **The attendance is an OBSERVATION, not a presumption** (#11). A human at the desk is stating that
 * she was in the room, so it is `reservation.attended` with a human source — never the `system`
 * actor and never `reservation.auto_resolved`, which belong to the nightly sweep. The event's
 * `minutesAfterStart` therefore reads in days rather than minutes, and that is the truth: this was
 * recorded long after the class.
 *
 * Everything is decided by the SAME functions the live path uses, so capacity, the category wall, the
 * service wall, credit availability and double-booking all refuse exactly as they would today. What
 * `backdate` changes is only what it must: the past is allowed, the studio's opening hours are not
 * re-litigated, and the package's start date is checked (see `decideBooking`).
 *
 * The per-member reservation LIMITS are deliberately not applied. They ration what she may still
 * book; a class she has already attended cannot be rationed, and refusing it would leave the ledger
 * wrong to enforce a rule about the future.
 */
export async function bookPastAttended(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: BookPastAttendedInput,
): Promise<Result<{ reservationId: ReservationId }, DomainError>> {
  const dctx = decideContext(deps, ctx)
  const reservationId = newReservationId()
  const hours = await deps.hours.getStudioHours(ctx)

  return deps.repo.book(ctx, {
    sessionId: input.sessionId,
    entitlementId: input.entitlementId,
    memberId: input.memberId,
    decide: (session, entitlement, memberHasBooked): Result<BookDecision, DomainError> => {
      const booked = decideBooking(
        dctx,
        session,
        entitlement,
        {
          reservationId,
          memberId: input.memberId,
          memberSnapshot: input.memberSnapshot,
          backdate: { earliest: input.earliest },
        },
        memberHasBooked,
        hours,
        // No `limits` — see the note above.
      )
      if (!booked.ok) return booked

      // ── Hold, exactly as a live booking does. A period (unlimited) package holds nothing. ──
      const held =
        entitlement.credits === null ? { entitlement, events: [] as BookDecision['events'] } : null
      let nextEntitlement = entitlement
      let events = [...booked.value.events]
      if (!held) {
        const hold = decideHold(dctx, entitlement, reservationId)
        if (!hold.ok) return hold
        nextEntitlement = hold.value.next
        events = [...events, ...hold.value.events]
      }

      // ── …and resolve it in the same breath. `decideAttendance` reads the reservation's own
      //    `creditEffect`, so an unlimited membership resolves with 'none' and moves no counter. ──
      const attended = decideAttendance(dctx, booked.value.reservation, session, 'attended')
      if (!attended.ok) return attended
      events = [...events, ...attended.value.events]

      if (attended.value.reservation.creditEffect === 'consumed') {
        const consumed = decideConsume(dctx, nextEntitlement, reservationId, 'attended')
        if (!consumed.ok) return consumed
        nextEntitlement = consumed.value.next
        events = [...events, ...consumed.value.events]
      }

      return ok({
        reservation: attended.value.reservation,
        nextEntitlement,
        // A resolved booking still occupied the room, so the seat count moves — the same as a class
        // marked attended in the ordinary way.
        bookedCountAfter: session.bookedCount + 1,
        events,
      })
    },
  })
}
