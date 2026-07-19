import {
  instant,
  newEntitlementId,
  type DomainError,
  type EntitlementId,
  type MemberId,
  type Money,
  type ProductId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decidePurchase } from '../domain/decide'
import type { CreditLedger, Entitlement, FreezeState, Grant, ProductSnapshot } from '../domain/types'
import { decideContext } from './context'
import type { EntitlementsDeps } from './ports'

const MS_PER_DAY = 86_400_000

// The catalogue is data (AD-41): the caller supplies the ProductSnapshot it froze
// at purchase; this module never names a product, price, or credit count.
export interface PurchaseEntitlementInput {
  readonly memberId: MemberId
  readonly productId: ProductId
  readonly productSnapshot: ProductSnapshot
  readonly policyRef: { readonly policyId: string; readonly version: number }
  readonly priceAgreed: Money
  readonly validFrom: number // epoch ms; validUntil is derived from the grant
  readonly freezeDays: number | null // freeze budget; null ⇔ freezing not permitted
}

function ledgerFor(grant: Grant): CreditLedger | null {
  if (grant.kind !== 'credits') return null
  return { granted: grant.credits, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 }
}

function validityDays(grant: Grant): number {
  return grant.kind === 'credits' ? grant.validForDays : grant.durationDays
}

function freezeFor(freezeDays: number | null): FreezeState | null {
  if (freezeDays === null) return null
  return { entitledDays: freezeDays, usedDays: 0, periods: [], activeFrom: null }
}

export async function purchaseEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: PurchaseEntitlementInput,
): Promise<Result<{ entitlementId: EntitlementId }, DomainError>> {
  const validFrom = instant(input.validFrom)
  const validUntil = instant(input.validFrom + validityDays(input.productSnapshot.grant) * MS_PER_DAY)

  const entitlement: Entitlement = {
    id: newEntitlementId(),
    studioId: ctx.studioId,
    memberId: input.memberId,
    productId: input.productId,
    productSnapshot: input.productSnapshot,
    policyRef: input.policyRef,
    status: 'active',
    validFrom,
    validUntil,
    credits: ledgerFor(input.productSnapshot.grant),
    freeze: freezeFor(input.freezeDays),
    cancellationLedger: { used: 0, refunded: 0 }, // Plus Phase 3 — a fresh package has spent nothing
    entryLedger: { consumed: 0, restored: 0 }, // v1.27 — fitness serbest-giriş meter
    priceAgreed: input.priceAgreed,
    paidTotal: { amount: 0, currency: input.priceAgreed.currency },
    manualPayment: null,
    purchasedAt: deps.clock.now(),
  }

  await deps.repo.saveEntitlement(ctx, entitlement, decidePurchase(decideContext(deps, ctx), entitlement))
  return { ok: true, value: { entitlementId: entitlement.id } }
}
