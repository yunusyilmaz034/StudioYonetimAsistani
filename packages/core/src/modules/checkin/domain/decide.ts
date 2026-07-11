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
import type { BranchOccupancy, CheckIn, CheckInMethod, Presence } from './types'

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
}

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
