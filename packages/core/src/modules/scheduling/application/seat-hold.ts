import {
  newSeatHoldId,
  type ClassSessionId,
  type DomainError,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideHoldSeat, decideReleaseSeat } from '../domain/decide'
import type { SeatHold } from '../domain/types'
import { decideContext } from './service'
import type { SchedulingDeps } from './ports'

// Holding a seat for someone who is not a member (owner, 2026-07-27).
//
// Multisport visitors write to the studio's WhatsApp asking whether there is room, and reception
// puts a name against a seat. They are day guests: no account, no package, nothing bought — and the
// owner is explicit that they must NOT be registered as members, because they are not.
//
// The seat is gone from the room either way, so it has to leave the capacity count. Everything else
// a reservation does — a credit, a roster row, member stats — must not happen, which is why this is
// its own small thing rather than a reservation with the awkward parts skipped.
//
// The session document and the hold are written TOGETHER. If they could drift, the counter would
// eventually disagree with the holds and reception would be told a full class had room.

export interface HoldSeatInput {
  readonly classSessionId: ClassSessionId
  /** Who the seat is for. Mandatory — an anonymous hold is a seat nobody can explain. */
  readonly note: string
  readonly cardNumber?: string | null
}

export async function holdSeat(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: HoldSeatInput,
): Promise<Result<{ holdId: string }, DomainError>> {
  const dctx = decideContext(deps, ctx)
  const holdId = newSeatHoldId()
  return deps.repo.holdSeat(ctx, {
    classSessionId: input.classSessionId,
    decide: (session) =>
      decideHoldSeat(dctx, session, {
        holdId,
        note: input.note,
        cardNumber: input.cardNumber ?? null,
      }),
  })
}

export async function releaseSeat(
  deps: SchedulingDeps,
  ctx: TenantContext,
  holdId: string,
): Promise<Result<void, DomainError>> {
  const dctx = decideContext(deps, ctx)
  return deps.repo.releaseSeat(ctx, {
    holdId,
    decide: (session, hold) => decideReleaseSeat(dctx, session, hold),
  })
}

/** The holds a screen needs: everything still held for one session. */
export function listHolds(
  deps: SchedulingDeps,
  ctx: TenantContext,
  classSessionId: ClassSessionId,
): Promise<readonly SeatHold[]> {
  return deps.repo.listSeatHolds(ctx, classSessionId)
}
