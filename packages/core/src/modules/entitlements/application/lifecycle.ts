import type { DomainError, EntitlementId, PaymentId, Result, TenantContext } from '../../../shared'
import { decideCancel, decideExpire } from '../domain/decide'
import { decideContext, loadEntitlement } from './context'
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
  const outcome = decideExpire(decideContext(deps, ctx), ent)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}
