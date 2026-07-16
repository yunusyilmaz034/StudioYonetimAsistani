import {
  instant,
  newEntitlementId,
  type DomainError,
  type EntitlementId,
  type MemberId,
  type Money,
  type NewEvent,
  type ProductId,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideAdjust,
  decideAmend,
  decidePurchase,
  decideReactivate,
  decideRecordPayment,
} from '../domain/decide'
import type { AmendPatch } from '../domain/decide'
import {
  available,
  type CreditLedger,
  type Entitlement,
  type FreezeState,
  type Grant,
  type PaymentMethod,
  type ProductSnapshot,
} from '../domain/types'
import { decideContext, loadEntitlement } from './context'
import type { EntitlementsDeps } from './ports'

const MS_PER_DAY = 86_400_000

const ledgerFor = (grant: Grant): CreditLedger | null =>
  grant.kind === 'credits'
    ? { granted: grant.credits, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 }
    : null
const validityDays = (grant: Grant): number => (grant.kind === 'credits' ? grant.validForDays : grant.durationDays)
const freezeFor = (freezeDays: number | null): FreezeState | null =>
  freezeDays === null ? null : { entitledDays: freezeDays, usedDays: 0, periods: [], activeFrom: null }

export interface AssignSubscriptionInput {
  readonly memberId: MemberId
  readonly productId: ProductId
  readonly productSnapshot: ProductSnapshot
  readonly policyRef: { readonly policyId: string; readonly version: number }
  readonly priceAgreed: Money
  readonly validFrom: number // epoch ms
  readonly validUntil: number | null // override; null ⇒ derived from the grant
  readonly freezeDays: number | null
  readonly creditOverride: number | null // desired credit count; null ⇒ product default
  readonly collectedAmount: Money // 0 ⇒ no payment (comp / on account)
  readonly method: PaymentMethod
  readonly note: string // açıklama — the adjust note (if overriding) and the payment note
}

// Manual subscription assignment (v1.14). Atomic: build the entitlement, optionally
// adjust the credit to a custom count (reusing the existing adjustment mechanism —
// no new arithmetic), optionally record the manual payment — one save, one
// correlationId. Not a payments/allocation engine.
export async function assignSubscription(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: AssignSubscriptionInput,
): Promise<Result<{ entitlementId: EntitlementId }, DomainError>> {
  const dctx = decideContext(deps, ctx)
  const grant = input.productSnapshot.grant
  const validFrom = instant(input.validFrom)
  const validUntil = instant(input.validUntil ?? input.validFrom + validityDays(grant) * MS_PER_DAY)

  let ent: Entitlement = {
    id: newEntitlementId(),
    studioId: ctx.studioId,
    memberId: input.memberId,
    productId: input.productId,
    productSnapshot: input.productSnapshot,
    policyRef: input.policyRef,
    status: 'active',
    validFrom,
    validUntil,
    credits: ledgerFor(grant),
    freeze: freezeFor(input.freezeDays),
    cancellationLedger: { used: 0, refunded: 0 }, // Plus Phase 3
    priceAgreed: input.priceAgreed,
    paidTotal: { amount: 0, currency: input.priceAgreed.currency },
    manualPayment: null,
    purchasedAt: dctx.now,
  }
  const events: NewEvent[] = [...decidePurchase(dctx, ent)]

  // Credit override → adjust to the desired count (reuses decideAdjust — I-1/I-3).
  if (input.creditOverride !== null && ent.credits && input.creditOverride !== available(ent.credits)) {
    const delta = input.creditOverride - available(ent.credits)
    const adj = decideAdjust(dctx, ent, delta, 'correction', input.note)
    if (!adj.ok) return adj
    ent = adj.value.next
    events.push(...adj.value.events)
  }

  // Manual payment (record-only) when something was collected.
  if (input.collectedAmount.amount > 0) {
    const pay = decideRecordPayment(dctx, ent, {
      collectedAmount: input.collectedAmount,
      method: input.method,
      note: input.note.trim() || null,
    })
    if (!pay.ok) return pay
    ent = pay.value.next
    events.push(...pay.value.events)
  }

  await deps.repo.saveEntitlement(ctx, ent, events)
  return { ok: true, value: { entitlementId: ent.id } }
}

export interface AmendEntitlementInput {
  readonly entitlementId: EntitlementId
  readonly patch: AmendPatch
  readonly reason: string
}

export async function amendEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: AmendEntitlementInput,
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideAmend(decideContext(deps, ctx), ent, input.patch, input.reason)
  if (!outcome.ok) return outcome
  if (outcome.value.events.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

export async function reactivateEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: { entitlementId: EntitlementId; reason: string },
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideReactivate(decideContext(deps, ctx), ent, input.reason)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}
