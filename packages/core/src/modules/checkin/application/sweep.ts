import { instant, type Result, type DomainError, type TenantContext } from '../../../shared'
import { decideAutoCheckOut } from '../domain/decide'
import { decideContext, SYSTEM_SWEEP_SOURCE } from './context'
import type { CheckinDeps } from './ports'

export interface AutoCheckOutSummary {
  readonly checkedOut: number
}

const MS_PER_HOUR = 3_600_000

// The nightly auto-check-out sweep (D4, actor: `system`). Anyone inside longer than
// `thresholdHours` is checked out — otherwise occupancy never returns to zero. The
// threshold is policy data, passed in (the code never knows the number).
export async function sweepAutoCheckOut(
  deps: CheckinDeps,
  ctx: TenantContext,
  thresholdHours: number,
): Promise<Result<AutoCheckOutSummary, DomainError>> {
  const now = deps.clock.now()
  const before = instant(now - thresholdHours * MS_PER_HOUR)
  const stale = await deps.repo.listStalePresence(ctx, before)

  let checkedOut = 0
  for (const presence of stale) {
    const dctx = decideContext(deps, ctx, { source: SYSTEM_SWEEP_SOURCE })
    const events = decideAutoCheckOut(dctx, presence, thresholdHours)
    await deps.repo.applyAutoCheckOut(ctx, presence.memberId, events)
    checkedOut += 1
  }
  return { ok: true, value: { checkedOut } }
}
