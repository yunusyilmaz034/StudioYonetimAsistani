import {
  newOperationId,
  type ClassSessionId,
  type OperationId,
  type TenantContext,
} from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { ClassSession } from '../../scheduling'
import {
  planBulkCancel,
  planBulkMove,
  type BulkCancelRow,
  type BulkMoveCandidate,
  type BulkMoveRow,
} from '../domain/bulk'
import type { Reservation } from '../domain/types'
import { cancelReservation } from './cancel'
import { decideContext } from './context'
import { moveReservation } from './move'
import type { ReservationsDeps } from './ports'

// TOPLU REZERVASYON İŞLEMLERİ — load, plan, apply (v1.27 S7).
//
// ── Every item is its own transaction. There is no rollback, and there must not be one. ─────
// Cancelling six reservations is six state writes and six events, and a seventh that fails does not
// un-write the first six — nor should it: each of those six is a real, completed act with a real
// credit movement behind it. What this owes reception instead is **the truth afterwards**: which
// ones went through, which did not, and why. A bulk act that reports "başarısız" and leaves her
// guessing which half happened is worse than one that never ran.
//
// ── One operationId ties them together ──────────────────────────────────────────────────────
// Every event written by one bulk act carries the same correlation id (OP-2), so the Activity Center
// can answer "what else did this do?" — and so the six cancellations read as one decision a human
// made, not six coincidences.

export interface BulkWorld {
  readonly session: ClassSession
  /** The still-`booked` reservations on the source session. */
  readonly reservations: readonly Reservation[]
  readonly target: ClassSession | null
  /** Member ids already booked into the target — moving one there again is a double booking. */
  readonly targetMemberIds: ReadonlySet<string>
  readonly entitlements: ReadonlyMap<string, Entitlement>
}

export interface BulkReservationsDeps extends ReservationsDeps {
  loadWorld(
    ctx: TenantContext,
    input: { sessionId: ClassSessionId; targetSessionId: ClassSessionId | null },
  ): Promise<BulkWorld>
}

const pick = (world: BulkWorld, ids: readonly string[]): readonly Reservation[] =>
  ids.length === 0
    ? world.reservations
    : world.reservations.filter((r) => ids.includes(r.id as string))

// ── Cancel ──────────────────────────────────────────────────────────────────────────────────

export async function previewBulkCancel(
  deps: BulkReservationsDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; reservationIds: readonly string[] },
): Promise<readonly BulkCancelRow[]> {
  const world = await deps.loadWorld(ctx, { sessionId: input.sessionId, targetSessionId: null })
  return planBulkCancel(decideContext(deps, ctx), world.session, pick(world, input.reservationIds))
}

export interface BulkOutcome {
  readonly operationId: OperationId
  readonly applied: number
  readonly failed: readonly { readonly reservationId: string; readonly memberName: string; readonly code: string }[]
}

export async function applyBulkCancel(
  deps: BulkReservationsDeps,
  ctx: TenantContext,
  input: { sessionId: ClassSessionId; reservationIds: readonly string[] },
): Promise<BulkOutcome> {
  const world = await deps.loadWorld(ctx, { sessionId: input.sessionId, targetSessionId: null })
  const targets = pick(world, input.reservationIds)
  const operationId = newOperationId()

  const failed: { reservationId: string; memberName: string; code: string }[] = []
  let applied = 0
  for (const r of targets) {
    const res = await cancelReservation(deps, ctx, { reservationId: r.id, operationId })
    if (res.ok) applied++
    else
      failed.push({
        reservationId: r.id as string,
        memberName: r.memberSnapshot.displayName,
        code: res.error.code,
      })
  }
  return { operationId, applied, failed }
}

// ── Move ────────────────────────────────────────────────────────────────────────────────────

const candidatesOf = (world: BulkWorld, targets: readonly Reservation[]): BulkMoveCandidate[] =>
  targets.flatMap((r) => {
    const entitlement = world.entitlements.get(r.entitlementId as string)
    if (!entitlement) return [] // the ledger row is gone — the move has nothing to hold a credit on
    return [
      {
        reservation: r,
        entitlement,
        alreadyBookedTarget: world.targetMemberIds.has(r.memberId as string),
      },
    ]
  })

export async function previewBulkMove(
  deps: BulkReservationsDeps,
  ctx: TenantContext,
  input: {
    sessionId: ClassSessionId
    targetSessionId: ClassSessionId
    reservationIds: readonly string[]
    overrideReason: string | null
  },
): Promise<readonly BulkMoveRow[]> {
  const world = await deps.loadWorld(ctx, {
    sessionId: input.sessionId,
    targetSessionId: input.targetSessionId,
  })
  if (!world.target) throw new Error(`Target session not found: ${input.targetSessionId}`)

  return planBulkMove(
    decideContext(deps, ctx),
    world.session,
    world.target,
    candidatesOf(world, pick(world, input.reservationIds)),
    input.overrideReason,
    await deps.hours.getStudioHours(ctx),
  )
}

export async function applyBulkMove(
  deps: BulkReservationsDeps,
  ctx: TenantContext,
  input: {
    sessionId: ClassSessionId
    targetSessionId: ClassSessionId
    reservationIds: readonly string[]
    overrideReason: string | null
  },
): Promise<BulkOutcome> {
  const world = await deps.loadWorld(ctx, {
    sessionId: input.sessionId,
    targetSessionId: input.targetSessionId,
  })
  if (!world.target) throw new Error(`Target session not found: ${input.targetSessionId}`)

  const targets = pick(world, input.reservationIds)
  const operationId = newOperationId()

  const failed: { reservationId: string; memberName: string; code: string }[] = []
  let applied = 0
  for (const r of targets) {
    // Each move re-decides inside its own transaction against the target's CURRENT seat count, so
    // the room cannot be oversold by a plan that was drawn a minute ago. A row the plan promised may
    // still be refused here — and it is reported, never silently dropped.
    const res = await moveReservation(deps, ctx, {
      reservationId: r.id,
      targetSessionId: input.targetSessionId,
      overrideReason: input.overrideReason,
      operationId,
    })
    if (res.ok) applied++
    else
      failed.push({
        reservationId: r.id as string,
        memberName: r.memberSnapshot.displayName,
        code: res.error.code,
      })
  }
  return { operationId, applied, failed }
}

