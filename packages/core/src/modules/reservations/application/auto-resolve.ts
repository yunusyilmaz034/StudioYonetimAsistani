import {
  ok,
  type DomainError,
  type ReservationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideConsume, decideRelease } from '../../entitlements'
import { decideAutoResolution } from '../domain/decide'
import { decideContext, SYSTEM_SWEEP_SOURCE } from './context'
import type { ReservationsDeps, ResolveDecision } from './ports'

// Auto-resolution of ONE reservation (actor: `system`, source: `system_sweep`).
// Emits `reservation.auto_resolved` with `source: 'system_default'` — NEVER
// `reservation.attended` (AD-38, I-18). `decideAutoResolution` re-checks the grace
// window inside the transaction, so a not-yet-eligible candidate is refused with
// `auto_resolve_too_early` and nothing is written.
export async function autoResolveReservation(
  deps: ReservationsDeps,
  ctx: TenantContext,
  reservationId: ReservationId,
): Promise<Result<void, DomainError>> {
  const dctx = decideContext(deps, ctx, { source: SYSTEM_SWEEP_SOURCE })

  return deps.repo.resolve(ctx, {
    reservationId,
    decide: (reservation, session, entitlement): Result<ResolveDecision, DomainError> => {
      const resolved = decideAutoResolution(dctx, reservation, session, entitlement)
      if (!resolved.ok) return resolved

      const effect = resolved.value.reservation.creditEffect
      const baseEvents = resolved.value.events
      if (entitlement.credits === null || effect === 'none') {
        return ok({ reservation: resolved.value.reservation, nextEntitlement: null, events: baseEvents })
      }
      const ledger =
        effect === 'consumed'
          ? decideConsume(dctx, entitlement, reservationId, 'auto_resolved')
          : decideRelease(dctx, entitlement, reservationId, 'auto_resolved')
      if (!ledger.ok) return ledger
      return ok({
        reservation: resolved.value.reservation,
        nextEntitlement: ledger.value.next,
        events: [...baseEvents, ...ledger.value.events],
      })
    },
  })
}

export interface AutoResolveSummary {
  readonly resolved: number
  readonly skipped: number // not yet past the grace window, or already resolved
  readonly failed: number // an unexpected domain refusal — surfaced, never swallowed
}

// The nightly sweep for one studio: every still-`booked` reservation whose session
// has ended is a candidate; the per-reservation transaction re-validates the grace
// window and resolves the eligible ones. Runs BEFORE the expiry sweep (I-19) — a
// held credit must settle before its package can expire.
export async function sweepAutoResolve(
  deps: ReservationsDeps,
  ctx: TenantContext,
): Promise<AutoResolveSummary> {
  const now = deps.clock.now()
  const candidates = await deps.repo.listResolvableBooked(ctx, now)

  let resolved = 0
  let skipped = 0
  let failed = 0
  for (const r of candidates) {
    const res = await autoResolveReservation(deps, ctx, r.id)
    if (res.ok) {
      resolved += 1
    } else if (res.error.code === 'auto_resolve_too_early' || res.error.code === 'reservation_not_open') {
      skipped += 1
    } else {
      failed += 1
    }
  }
  return { resolved, skipped, failed }
}
