import { instant, type Result, type DomainError, type TenantContext } from '../../../shared'
import { autoCheckOutDeadline, decideAutoCheckOut, type AutoCheckOutPolicy } from '../domain/decide'
import { EARLY_ARRIVAL_MS } from './checkin'
import { decideContext, SYSTEM_SWEEP_SOURCE } from './context'
import type { CheckinDeps } from './ports'

export interface AutoCheckOutSummary {
  readonly checkedOut: number
}

const MS_PER_HOUR = 3_600_000

// The auto-check-out sweep (D4, actor: `system`). Anyone still inside past their visit's deadline is
// checked out — otherwise occupancy never returns to zero. The deadline is per visit (owner,
// 2026-10-14): a member who came for a class is out at the class's end plus a margin, anyone else a
// fixed time after entry (`autoCheckOutDeadline`). The numbers are policy, passed in.
//
// Every open presence is read, not only the old ones: a class-day visit can end before a gym visit
// would, so no single "checked in before" cut-off is right. The set is the people in the building.
export async function sweepAutoCheckOut(
  deps: CheckinDeps,
  ctx: TenantContext,
  policy: AutoCheckOutPolicy,
): Promise<Result<AutoCheckOutSummary, DomainError>> {
  const now = deps.clock.now()
  const inside = await deps.repo.listStalePresence(ctx, instant(now))

  let checkedOut = 0
  for (const presence of inside) {
    const classEndsAt = await deps.classes.classEndAround(ctx, presence.memberId, presence.checkedInAt, EARLY_ARRIVAL_MS)
    const deadline = autoCheckOutDeadline(presence.checkedInAt, classEndsAt, policy)
    if (deadline > now) continue
    const dctx = decideContext(deps, ctx, { source: SYSTEM_SWEEP_SOURCE })
    // `thresholdHours` stays what it always meant: how long after entry this visit was closed.
    const thresholdHours = Math.round(((deadline - presence.checkedInAt) / MS_PER_HOUR) * 100) / 100
    const events = decideAutoCheckOut(dctx, presence, thresholdHours)
    await deps.repo.applyAutoCheckOut(ctx, presence.memberId, events)
    checkedOut += 1
  }
  return { ok: true, value: { checkedOut } }
}
