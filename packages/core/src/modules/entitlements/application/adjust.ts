import type { DomainError, EntitlementId, Result, TenantContext } from '../../../shared'
import { decideAdjust } from '../domain/decide'
import type { AdjustmentReason } from '../domain/types'
import { decideContext, loadEntitlement } from './context'
import type { EntitlementsDeps } from './ports'

export interface AdjustCreditsInput {
  readonly entitlementId: EntitlementId
  readonly delta: number
  readonly reason: AdjustmentReason
  readonly note: string
}

// Admin credit adjustment (AD-39, I-20): closed-enum reason + mandatory note,
// enforced in the domain. A decrease below zero is refused, never clamped.
export async function adjustCredits(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: AdjustCreditsInput,
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideAdjust(decideContext(deps, ctx), ent, input.delta, input.reason, input.note)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}
