import { describe, expect, it } from 'vitest'

import { decideConsumeEntry, decideRestoreEntry, type DecideContext } from './decide'
import type { Entitlement } from './types'
import {
  instant,
  money,
  type CorrelationId,
  type DeviceId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type StudioId,
} from '../../../shared'

// Fitness serbest-giriş cap (v1.27). SOFT: over-use is recorded, never refused — the only refusals are
// structural (not active, not a capped membership, or a correction with no reason / nothing to give back).

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'device', id: 'dev_kiosk' as DeviceId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'kiosk',
}

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  id: 'ent_1' as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1' as MemberId,
  productId: 'prd_1' as ProductId,
  productSnapshot: { productId: 'prd_1' as ProductId, name: 'Fitness Aylık', category: 'fitness', grant: { kind: 'period', durationDays: 30, access: 'unlimited' }, listPrice: money(800_000), entryAllowance: 4 },
  policyRef: { policyId: 'pol_1', version: 1 },
  status: 'active',
  validFrom: instant(1_699_000_000_000),
  validUntil: instant(1_800_000_000_000),
  credits: null,
  freeze: null,
  cancellationLedger: { used: 0, refunded: 0 },
  entryLedger: { consumed: 0, restored: 0 },
  priceAgreed: money(800_000),
  paidTotal: money(0),
  manualPayment: null,
  purchasedAt: instant(1_699_000_000_000),
  ...over,
})

describe('decideConsumeEntry — a door check-in spends one entry', () => {
  it('consumes and reports the net used after', () => {
    const r = decideConsumeEntry(ctx, ent(), 'chk_1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.entryLedger.consumed).toBe(1)
    expect((r.value.events[0]?.payload as { entriesUsedAfter: number }).entriesUsedAfter).toBe(1)
  })

  it('SOFT: keeps recording past the allowance (5th entry on a 4-cap is allowed)', () => {
    const r = decideConsumeEntry(ctx, ent({ entryLedger: { consumed: 4, restored: 0 } }), 'chk_5')
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.value.events[0]?.payload as { entriesUsedAfter: number }).entriesUsedAfter).toBe(5) // over the 4-cap, still recorded
  })

  it('refuses an inactive membership', () => {
    expect(decideConsumeEntry(ctx, ent({ status: 'expired' }), 'chk_1').ok).toBe(false)
    expect(decideConsumeEntry(ctx, ent({ status: 'cancelled' }), 'chk_1').ok).toBe(false)
  })

  it('refuses an UNLIMITED membership — nothing to spend', () => {
    const unlimited = ent({ productSnapshot: { ...ent().productSnapshot, entryAllowance: null } })
    expect(decideConsumeEntry(ctx, unlimited, 'chk_1').ok).toBe(false)
  })
})

describe('decideRestoreEntry — a compensating correction', () => {
  it('gives one back and needs a reason (#9)', () => {
    const used = ent({ entryLedger: { consumed: 2, restored: 0 } })
    const r = decideRestoreEntry(ctx, used, 'chk_1', 'yanlış check-in iptali')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.entryLedger.restored).toBe(1)
    expect(decideRestoreEntry(ctx, used, 'chk_1', '   ').ok).toBe(false) // reason required
  })

  it('refuses when there is nothing to restore', () => {
    expect(decideRestoreEntry(ctx, ent(), 'chk_1', 'x').ok).toBe(false) // net used is 0
  })
})
