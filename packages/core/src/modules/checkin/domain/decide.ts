import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type BranchId,
  type CheckInId,
  type CommandId,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  BRANCH_CLOSED,
  BRANCH_OPENED,
  MEMBER_AUTO_CHECKED_OUT,
  MEMBER_CHECKED_IN,
  MEMBER_CHECKED_OUT,
} from '../events'
import type { BranchOccupancy, CheckIn, CheckInMethod, Presence, CheckInDirection } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
  // The command that caused this event (a QR/manual check-in from the /commands path).
  readonly commandId?: CommandId | null
}

function base(ctx: DecideContext, kind: AggregateKind, id: string, branchId: BranchId, related: Record<string, string>) {
  return {
    studioId: ctx.studioId,
    branchId,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind, id },
    related,
    policyRef: null,
    commandId: ctx.commandId ?? null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// ── Branch open/close (D3). Reception bounds the occupancy window. Idempotent. ──
export interface BranchOutcome {
  readonly events: readonly NewEvent[]
  readonly branchNext: BranchOccupancy
}

export function decideOpenBranch(
  ctx: DecideContext,
  branchId: BranchId,
  current: BranchOccupancy | null,
): BranchOutcome {
  if (current?.isOpen) return { events: [], branchNext: current }
  const branchNext: BranchOccupancy = { branchId, isOpen: true, openedAt: ctx.now }
  return {
    events: [{ ...base(ctx, 'branch', branchId, branchId, {}), type: BRANCH_OPENED, payload: { scheduledOpenAt: ctx.now } }],
    branchNext,
  }
}

export function decideCloseBranch(
  ctx: DecideContext,
  branchId: BranchId,
  current: BranchOccupancy | null,
  currentOccupancy: number,
): BranchOutcome {
  if (!current?.isOpen) return { events: [], branchNext: current ?? { branchId, isOpen: false, openedAt: null } }
  const branchNext: BranchOccupancy = { branchId, isOpen: false, openedAt: null }
  return {
    events: [{ ...base(ctx, 'branch', branchId, branchId, {}), type: BRANCH_CLOSED, payload: { occupancyAtClose: currentOccupancy } }],
    branchNext,
  }
}

// ── Check-in / check-out (D5, toggle). A scan flips in/out from the presence state.
//    A check-in is only allowed while the branch is open. `occupancyAfter` is
//    computed from the count the caller passed. ──
export interface CheckInInput {
  readonly checkInId: CheckInId // minted in the application (domain stays pure)
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly method: CheckInMethod
  /**
   * What reception ASKED FOR. Absent ⇒ the old toggle, which is right for a QR scan: the member
   * points her phone at the same code going in and coming out, and the door decides which it is.
   *
   * It is wrong for a button labelled "Çıkış". A toggle behind a labelled button means pressing it
   * twice silently puts her back inside, and that is exactly what happened: an exit recorded at
   * 18:41:27 and an entry at 18:41:49, with the screen confirming the exit and never mentioning the
   * reversal (owner, 2026-07-31).
   */
  readonly direction?: CheckInDirection
  /**
   * When this member last crossed the door, if she has. Used only to refuse a repeat within
   * seconds — see `DEBOUNCE_MS`.
   */
  readonly lastCrossedAt?: Instant
}

/**
 * A second scan this soon is the same arrival, not a departure.
 *
 * Nobody enters and leaves in half a minute. Two taps on a kiosk, a camera that fires twice, a
 * receptionist pressing again because the first press "did not look like it worked" — all of them
 * produce a pair of events seconds apart, and under a plain toggle the second one undoes the first.
 */
const DEBOUNCE_MS = 45_000

export interface CheckInOutcome {
  readonly events: readonly NewEvent[]
  readonly checkIn: CheckIn
  readonly presenceNext: Presence | null // null ⇔ deleted (checked out)
}

export function decideCheckIn(
  ctx: DecideContext,
  input: CheckInInput,
  presence: Presence | null,
  currentOccupancy: number,
  branch: BranchOccupancy | null,
): Result<CheckInOutcome, DomainError> {
  if (!branch?.isOpen) return err({ code: 'branch_not_open' })

  // ── What was asked for, when it was asked explicitly ──────────────────────────────────────
  if (input.direction === 'out' && presence === null) return err({ code: 'already_outside' })
  if (input.direction === 'in' && presence !== null) return err({ code: 'already_inside' })

  // ── The same crossing, twice ──────────────────────────────────────────────────────────────
  // Refused rather than silently ignored: the caller showed somebody a confirmation, and "it was
  // already recorded" is a different sentence from "done" — one of them is true.
  if (
    input.lastCrossedAt !== undefined &&
    ctx.now - input.lastCrossedAt < DEBOUNCE_MS &&
    input.direction === undefined
  ) {
    return err({ code: 'checkin_too_soon' })
  }

  const checkInBase = {
    id: input.checkInId,
    studioId: ctx.studioId,
    memberId: input.memberId,
    branchId: input.branchId,
    method: input.method,
    occurredAt: ctx.now,
    actor: ctx.actor,
  }
  const related = { memberId: input.memberId }

  if (presence === null) {
    const occupancyAfter = currentOccupancy + 1
    return ok({
      events: [
        {
          ...base(ctx, 'member', input.memberId, input.branchId, related),
          type: MEMBER_CHECKED_IN,
          payload: { branchId: input.branchId, method: input.method, occupancyAfter },
        },
      ],
      checkIn: { ...checkInBase, direction: 'in' },
      presenceNext: { memberId: input.memberId, branchId: input.branchId, checkedInAt: ctx.now },
    })
  }

  const occupancyAfter = Math.max(0, currentOccupancy - 1)
  const durationMinutes = Math.max(0, Math.floor((ctx.now - presence.checkedInAt) / 60_000))
  return ok({
    events: [
      {
        ...base(ctx, 'member', input.memberId, input.branchId, related),
        type: MEMBER_CHECKED_OUT,
        payload: { branchId: input.branchId, method: input.method, durationMinutes, occupancyAfter },
      },
    ],
    checkIn: { ...checkInBase, direction: 'out' },
    presenceNext: null,
  })
}

// ── Auto-check-out (D4, actor: system). A member inside past the threshold is checked
//    out by the sweep; the presence is deleted by the caller. ──
export function decideAutoCheckOut(
  ctx: DecideContext,
  presence: Presence,
  thresholdHours: number,
): readonly NewEvent[] {
  return [
    {
      ...base(ctx, 'member', presence.memberId, presence.branchId, { memberId: presence.memberId }),
      type: MEMBER_AUTO_CHECKED_OUT,
      payload: { branchId: presence.branchId, thresholdHours },
    },
  ]
}
