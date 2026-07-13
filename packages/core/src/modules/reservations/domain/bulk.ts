import type { ClassSession } from '../../scheduling'
import type { Entitlement } from '../../entitlements'
import type { DecideContext, StudioHours } from './decide'
import { decideCancellation, decideMove } from './decide'
import type { Reservation } from './types'

// TOPLU REZERVASYON İŞLEMLERİ — the plan (v1.27 S7). PURE.
//
// These are the acts reception does with a phone against her ear: *"Salı 19:00 iptal, herkesi Çarşamba
// 19:00'a alalım"*. Eight members, one decision, and eight credits that must each land in the right
// column.
//
// ── Why a planner rather than a loop in a Server Action ─────────────────────────────────────
// Because the ANSWER MUST BE SHOWN BEFORE IT IS APPLIED. A bulk act over a roster is exactly the
// shape of thing that quietly does the wrong thing seven times: a late cancel that burns a credit
// nobody meant to burn, a move into a class that has no room left, a member whose package does not
// open that room at all. Reception must see who is affected and how, and only then press the button.
//
// ── The rules are NOT re-implemented here ───────────────────────────────────────────────────
// The planner calls the same `decideCancellation` / `decideMove` the single-reservation path calls.
// A preview that re-derives the cancellation window in its own words is a preview that will one day
// disagree with the act it is previewing — and it will be believed, because it is the thing on screen.

/** What the member's credit does. `consumed` is the one reception must be warned about, loudly. */
export type BulkCreditEffect = 'released' | 'consumed' | 'none'

export interface BulkCancelRow {
  readonly reservationId: string
  readonly memberName: string
  readonly effect: BulkCreditEffect
  /** A domain refusal code, or `null` when this row would go through. */
  readonly refusal: string | null
}

/**
 * Cancel a roster, one reservation at a time, and say what each one costs the member.
 *
 * NOTE what this is not: it is not "the class was cancelled". A class that is not happening is
 * cancelled as a SESSION, and then every reservation on it releases unconditionally (I-14) — window
 * or no window. This is the other act: removing *these members* from a class that is still going
 * ahead. So the ordinary policy applies, and a member inside the cancellation window loses her
 * credit. That is the truth, and the preview says it out loud rather than discovering it afterwards.
 */
export function planBulkCancel(
  ctx: DecideContext,
  session: ClassSession,
  reservations: readonly Reservation[],
): readonly BulkCancelRow[] {
  return reservations.map((r) => {
    const decided = decideCancellation(ctx, r, session)
    if (!decided.ok) {
      return {
        reservationId: r.id as string,
        memberName: r.memberSnapshot.displayName,
        effect: 'none',
        refusal: decided.error.code,
      }
    }
    return {
      reservationId: r.id as string,
      memberName: r.memberSnapshot.displayName,
      effect: decided.value.reservation.creditEffect as BulkCreditEffect,
      refusal: null,
    }
  })
}

export interface BulkMoveCandidate {
  readonly reservation: Reservation
  readonly entitlement: Entitlement
  /** She is already booked into the target. Moving her there again would be a double booking. */
  readonly alreadyBookedTarget: boolean
}

export interface BulkMoveRow {
  readonly reservationId: string
  readonly memberName: string
  readonly refusal: string | null
}

/**
 * Move a roster to another session.
 *
 * ── The seat count is simulated as the plan walks ───────────────────────────────────────────
 * The target has three free seats and eight members are being moved. Deciding each row against the
 * target's *original* `bookedCount` would pass all eight — and then the apply would refuse five of
 * them, after the first three had already moved. A preview that promises what the act cannot deliver
 * is worse than no preview: reception has already told five women they are in the Wednesday class.
 *
 * So the plan fills the room as it goes, in the order shown, and the rows that do not fit say so.
 */
export function planBulkMove(
  ctx: DecideContext,
  from: ClassSession,
  to: ClassSession,
  candidates: readonly BulkMoveCandidate[],
  overrideReason: string | null,
  // AG-1 — the target answers to the studio's hours, and the PLAN says so before the apply does.
  hours: StudioHours,
): readonly BulkMoveRow[] {
  let taken = 0
  return candidates.map((c) => {
    const target: ClassSession = { ...to, bookedCount: to.bookedCount + taken }
    const decided = decideMove(
      ctx,
      c.reservation,
      from,
      target,
      c.entitlement,
      c.alreadyBookedTarget,
      hours,
      { overrideReason },
    )
    if (decided.ok) taken += 1
    return {
      reservationId: c.reservation.id as string,
      memberName: c.reservation.memberSnapshot.displayName,
      refusal: decided.ok ? null : decided.error.code,
    }
  })
}
