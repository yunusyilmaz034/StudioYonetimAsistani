import type { DomainError, EntitlementId, PaymentId, Result, TenantContext } from '../../../shared'
import { decideCancel, decideExpire } from '../domain/decide'
import { decideContext, loadEntitlement, SYSTEM_SWEEP_SOURCE } from './context'
import type { EntitlementsDeps } from './ports'

export interface CancelEntitlementInput {
  readonly entitlementId: EntitlementId
  readonly reason: string
  readonly refundPaymentId: PaymentId | null
}

export async function cancelEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: CancelEntitlementInput,
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideCancel(decideContext(deps, ctx), ent, input.reason, input.refundPaymentId)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

// Called by the expiry sweep with a `system` actor context (I-19: runs after the
// attendance auto-resolver, and refuses to touch an entitlement still holding a
// credit).
export async function expireEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  entitlementId: EntitlementId,
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, entitlementId)
  const outcome = decideExpire(decideContext(deps, ctx, SYSTEM_SWEEP_SOURCE), ent)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

export interface ExpirySummary {
  readonly expired: number
  readonly skipped: number // still holding a credit (I-19) or no longer active
  readonly failed: number
}

// The nightly expiry sweep for one studio. Runs AFTER auto-resolution (I-19): a
// reservation's held credit must settle first, or `decideExpire` refuses the package
// with `held_credits_block_expiry`. Unused credits become the churn signal (I-4).
export async function sweepExpireCredits(
  deps: EntitlementsDeps,
  ctx: TenantContext,
): Promise<ExpirySummary> {
  const now = deps.clock.now()
  const ids = await deps.repo.listExpirable(ctx, now)

  let expired = 0
  let skipped = 0
  let failed = 0
  for (const id of ids) {
    const res = await expireEntitlement(deps, ctx, id)
    if (res.ok) {
      expired += 1
    } else if (res.error.code === 'held_credits_block_expiry' || res.error.code === 'entitlement_not_active') {
      skipped += 1
    } else {
      failed += 1
    }
  }
  return { expired, skipped, failed }
}
