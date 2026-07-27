import {
  ok,
  type DomainError,
  type Instant,
  type MemberId,
  type ReservationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideConsume } from '../../entitlements'
import { decideCheckInResolution } from '../domain/decide'
import type { Reservation } from '../domain/types'
import { decideContext } from './context'
import type { ReservationsDeps, ResolveDecision } from './ports'

// Resolving a reservation because the member walked in (owner ask, 2026-07-27).
//
// The studio has no tablet at the desk, so the flow is inverted: a printed QR hangs on the wall and
// the MEMBER scans it with her own phone. That scan already recorded `member.checked_in` — an
// observation, she was at the door. This turns it into the attendance mark the studio actually
// needs, without waiting for the nightly sweep.
//
// Two rules keep it honest, and both live in `decideCheckInResolution`:
//   • it emits `reservation.auto_resolved`, never `.attended` — nobody watched her take the class
//   • it only speaks for a class near in time to the scan, so an early arrival cannot resolve an
//     evening booking that has not happened yet
//
// ONE reservation, the nearest. A member with a morning and an evening class has given us evidence
// of arriving ONCE; claiming both from a single scan would be inventing the second. The other is
// left to the sweep, exactly as before.

// How long before her class a member may arrive and still have the scan count for it. The number is
// the CALLER's (studio settings), never this module's — the domain is handed a window, not a belief.
export interface ResolveOnCheckInInput {
  readonly memberId: MemberId
  readonly at: Instant
  readonly arriveWithinMinutes: number
}

export interface CheckInResolution {
  readonly reservationId: ReservationId
  readonly sessionStartsAt: Instant
  readonly creditConsumed: boolean
}

/**
 * Best-effort by design: a refusal here NEVER fails the check-in. She is through the door either
 * way, and the sweep still owns everything this declines to resolve.
 *
 * Returns the resolution when one happened, or null when there was nothing near enough to resolve.
 */
export async function resolveOnCheckIn(
  deps: ReservationsDeps,
  ctx: TenantContext,
  input: ResolveOnCheckInInput,
): Promise<CheckInResolution | null> {
  const candidate = nearestBookedReservation(
    await deps.repo.listByMember(ctx, input.memberId),
    input.at,
    input.arriveWithinMinutes,
  )
  if (!candidate) return null

  const dctx = decideContext(deps, ctx, { source: 'member_checkin', now: input.at })
  let consumed = false

  const res = await deps.repo.resolve(ctx, {
    reservationId: candidate.id,
    decide: (reservation, session, entitlement): Result<ResolveDecision, DomainError> => {
      const resolved = decideCheckInResolution(dctx, reservation, session, entitlement, input.arriveWithinMinutes)
      if (!resolved.ok) return resolved

      const events = resolved.value.events
      if (entitlement.credits === null || resolved.value.reservation.creditEffect !== 'consumed') {
        return ok({ reservation: resolved.value.reservation, nextEntitlement: null, events })
      }
      const ledger = decideConsume(dctx, entitlement, candidate.id, 'auto_resolved')
      if (!ledger.ok) return ledger
      consumed = true
      return ok({
        reservation: resolved.value.reservation,
        nextEntitlement: ledger.value.next,
        events: [...events, ...ledger.value.events],
      })
    },
  })
  if (!res.ok) return null

  return {
    reservationId: candidate.id,
    sessionStartsAt: candidate.sessionStartsAt,
    creditConsumed: consumed,
  }
}

/**
 * The booked reservation whose class the scan most plausibly belongs to: inside the window, and of
 * those, the one starting closest to the moment she scanned. Pure and exported so the choice — the
 * part that decides whose credit moves — is testable without a repository.
 */
export function nearestBookedReservation(
  reservations: readonly Reservation[],
  at: Instant,
  arriveWithinMinutes: number,
): Reservation | null {
  const early = arriveWithinMinutes * 60_000
  const inWindow = reservations.filter(
    (r) =>
      r.status === 'booked' &&
      at >= r.sessionStartsAt - early &&
      // The tail is generous here and TIGHTENED inside the domain by the session's own grace policy,
      // which this list read cannot see: `sessionEndsAt` is denormalised, `autoResolveAfterMinutes`
      // is not. Over-selecting is safe — the decision refuses; under-selecting would silently drop a
      // resolvable class.
      at <= r.sessionEndsAt + early,
  )
  if (inWindow.length === 0) return null
  return inWindow.reduce((best, r) =>
    Math.abs(r.sessionStartsAt - at) < Math.abs(best.sessionStartsAt - at) ? r : best,
  )
}
