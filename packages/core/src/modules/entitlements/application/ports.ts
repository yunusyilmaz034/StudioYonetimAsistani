import type { Clock, EntitlementId, Instant, MemberId, NewEvent, TenantContext } from '../../../shared'
import type { Entitlement } from '../domain/types'

// One repository for the entitlement aggregate. Each save writes the entity + its
// events in one transaction (non-negotiable #1). Client writes are forbidden
// (AD-15) — these run only from Server Actions on the Admin SDK, or the expiry
// sweep's system context.
export interface EntitlementRepository {
  getEntitlement(ctx: TenantContext, id: EntitlementId): Promise<Entitlement | null>
  saveEntitlement(ctx: TenantContext, entitlement: Entitlement, events: readonly NewEvent[]): Promise<void>
  // The booking flow's candidate set for selectEntitlement (I-17). Active only; the
  // domain applies the finer bookability filter (validity, category, credits).
  listActiveByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Entitlement[]>
  // The expiry sweep's candidate set: active entitlements whose validity has passed.
  // `decideExpire` re-checks (and refuses while a credit is still held, I-19).
  listExpirable(ctx: TenantContext, validUntilAtOrBefore: Instant): Promise<readonly EntitlementId[]>
}

export interface EntitlementsDeps {
  readonly repo: EntitlementRepository
  readonly clock: Clock
}
