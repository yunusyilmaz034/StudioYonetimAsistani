import {
  clampOccurredAt,
  newCheckInId,
  type BranchId,
  type CommandId,
  type DomainError,
  type Instant,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideCheckIn } from '../domain/decide'
import type { CheckInMethod } from '../domain/types'
import { decideContext } from './context'
import type { CheckinDeps } from './ports'

export interface RecordCheckInInput {
  readonly memberId: MemberId
  readonly branchId: BranchId
  readonly method: CheckInMethod
  readonly occurredAt: Instant // domain time (offline-mintable), clamped
  readonly commandId: CommandId
}

// Applied by `on-command-created` from a `checkIn.record` command (QR scan or manual
// pick). A toggle: outside → check in, inside → check out. Idempotent by construction
// (a redelivery re-reads the presence and produces the mirror state); the branch must
// be open (D3).
export async function recordCheckIn(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: RecordCheckInInput,
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now()
  const dctx = decideContext(deps, ctx, { now: clampOccurredAt(input.occurredAt, now), commandId: input.commandId })

  const [branch, presence, occupancy] = await Promise.all([
    deps.repo.getBranch(ctx, input.branchId),
    deps.repo.getPresence(ctx, input.memberId),
    deps.repo.countPresence(ctx, input.branchId),
  ])

  const decided = decideCheckIn(
    dctx,
    { checkInId: newCheckInId(), memberId: input.memberId, branchId: input.branchId, method: input.method },
    presence,
    occupancy,
    branch,
  )
  if (!decided.ok) return decided

  await deps.repo.applyCheckIn(
    ctx,
    input.memberId,
    decided.value.checkIn,
    decided.value.presenceNext,
    decided.value.events,
  )
  return { ok: true, value: undefined }
}
