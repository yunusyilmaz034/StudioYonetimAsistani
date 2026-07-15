import { describe, expect, it } from 'vitest'

import {
  fixedClock,
  instant,
  money,
  type EntitlementId,
  type Instant,
  type MemberId,
  type NewEvent,
  type ProductId,
  type StudioId,
  type SystemJobId,
  type TenantContext,
} from '../../../shared'
import type { Entitlement } from '../domain/types'
import { sweepExpireCredits } from './lifecycle'
import type { EntitlementRepository } from './ports'

const NOW = instant(1_000_000_000_000)
const D = 86_400_000

// A `system`-actor context, as the nightly sweep builds it (role inert here).
const ctx: TenantContext = {
  studioId: 'std_1' as StudioId,
  branchIds: [],
  role: 'owner',
  actor: { type: 'system', id: 'credit_expiry_sweep' as SystemJobId },
}

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  id: 'ent_1' as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1' as MemberId,
  productId: 'prd_1' as ProductId,
  productSnapshot: {
    productId: 'prd_1' as ProductId,
    name: 'Pilates 8',
    category: 'pilates_group',
    grant: { kind: 'credits', credits: 8, validForDays: 30 },
    listPrice: money(420_000),
  },
  policyRef: { policyId: 'pol_1', version: 3 },
  status: 'active',
  validFrom: instant(NOW - 60 * D),
  validUntil: instant(NOW - D), // already lapsed
  credits: { granted: 8, held: 0, consumed: 6, restored: 0, revoked: 0, expired: 0 },
  freeze: null,
  cancellationLedger: { used: 0, refunded: 0 },
  priceAgreed: money(294_000),
  paidTotal: money(0),
  manualPayment: null,
  purchasedAt: instant(NOW - 60 * D),
  ...over,
})

class FakeEntRepo implements EntitlementRepository {
  readonly events: NewEvent[] = []
  constructor(readonly ents: Map<string, Entitlement>) {}
  async getEntitlement(_c: TenantContext, id: EntitlementId): Promise<Entitlement | null> {
    return this.ents.get(id) ?? null
  }
  async saveEntitlement(_c: TenantContext, e: Entitlement, events: readonly NewEvent[]): Promise<void> {
    this.ents.set(e.id, e)
    this.events.push(...events)
  }
  async listActiveByMember(): Promise<readonly Entitlement[]> {
    return []
  }
  async listFrozen(): Promise<readonly Entitlement[]> {
    return [...this.ents.values()].filter((e) => e.status === 'frozen')
  }
  async listAll(): Promise<readonly Entitlement[]> {
    return [...this.ents.values()]
  }
  async listExpirable(_c: TenantContext, before: Instant): Promise<readonly EntitlementId[]> {
    return [...this.ents.values()]
      .filter((e) => e.status === 'active' && e.validUntil <= before)
      .map((e) => e.id)
  }
  async listByMember(): Promise<readonly Entitlement[]> {
    return [...this.ents.values()]
  }
  async listEntitlementEvents(): Promise<readonly []> {
    return []
  }
  async listExpiringBetween(): Promise<readonly Entitlement[]> {
    return []
  }
  async listActive(): Promise<readonly Entitlement[]> {
    return [...this.ents.values()].filter((e) => e.status === 'active')
  }
}

describe('sweepExpireCredits (nightly, system, I-19)', () => {
  it('expires a lapsed package and skips one still holding a credit', async () => {
    const free = ent({ id: 'ent_free' as EntitlementId })
    const stillHeld = ent({
      id: 'ent_held' as EntitlementId,
      credits: { granted: 8, held: 1, consumed: 6, restored: 0, revoked: 0, expired: 0 },
    })
    const repo = new FakeEntRepo(
      new Map([
        [free.id, free],
        [stillHeld.id, stillHeld],
      ]),
    )
    const summary = await sweepExpireCredits({ repo, clock: fixedClock(NOW) }, ctx)

    expect(summary).toEqual({ expired: 1, skipped: 1, failed: 0 })
    expect(repo.ents.get('ent_free')?.status).toBe('expired')
    // The still-held package is untouched — I-19: it cannot expire before its credit settles.
    expect(repo.ents.get('ent_held')?.status).toBe('active')
    expect(repo.events.map((e) => e.type)).toEqual(['entitlement.expired'])
  })
})
