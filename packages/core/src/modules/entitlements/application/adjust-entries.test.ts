import { describe, expect, it } from 'vitest'

import { instant, money, type EntitlementId, type StudioId, type TenantContext } from '../../../shared'
import type { Entitlement } from '../domain/types'
import { entriesUsed } from '../domain/types'
import type { EntitlementsDeps } from './ports'
import { adjustEntries } from './adjust'

// WHY THIS FILE EXISTS.
//
// The desk asked for "5 entries left" and the package quietly became a 7-entry package. The first
// attempt at this fix made the displayed number right by moving `entryAllowance` — which is the
// PRODUCT's grant, not her usage. An 8-entry package that reports itself as 7 is a lie that outlives
// the correction: it shows up that way in every later report, and nothing can tell you it was edited.
//
// The rule these tests hold down: the grant never moves, the ledger does. Same discipline the credit
// side has always had (`granted` fixed, adjustments in the ledger).

const NOW = 1_800_000_000_000
const STUDIO = 'retro' as StudioId
const ENT = 'ent_1' as EntitlementId
const CTX = { studioId: STUDIO, branchIds: ['brn_1'], role: 'owner', actor: { type: 'owner', id: 'usr_1' } } as unknown as TenantContext

const entitlement = (allowance: number | null, consumed: number, restored = 0): Entitlement =>
  ({
    id: ENT,
    studioId: STUDIO,
    memberId: 'mem_1',
    productId: 'prd_1',
    productSnapshot: {
      productId: 'prd_1',
      name: 'Hibrit Aylık — 2 Fitness + 1 Pilates',
      category: 'fitness',
      grant: { kind: 'period', durationDays: 30, access: 'unlimited' },
      listPrice: money(500_000),
      ...(allowance === null ? {} : { entryAllowance: allowance }),
    },
    policyRef: { policyId: 'pol_1', version: 1 },
    status: 'active',
    validFrom: instant(NOW - 86_400_000),
    validUntil: instant(NOW + 30 * 86_400_000),
    credits: null,
    freeze: null,
    cancellationLedger: { used: 0, refunded: 0 },
    entryLedger: { consumed, restored },
    priceAgreed: money(500_000),
    paidTotal: money(500_000),
    manualPayment: null,
    purchasedAt: instant(NOW - 86_400_000),
  }) as unknown as Entitlement

function fakeDeps(start: Entitlement) {
  let current = start
  const saved: Entitlement[] = []
  const deps = {
    clock: { now: () => instant(NOW) },
    repo: {
      getEntitlement: async () => current,
      saveEntitlement: async (_c: TenantContext, e: Entitlement) => {
        current = e
        saved.push(e)
      },
    },
  } as unknown as EntitlementsDeps
  return { deps, saved, now: () => current }
}

describe('adjustEntries — the package keeps its size, the meter moves', () => {
  it("sets the remainder without touching the product's grant — the reported case", async () => {
    // 8-entry package, 5 spent, 3 left. The desk wants 5 left.
    const { deps, now } = fakeDeps(entitlement(8, 5))
    const r = await adjustEntries(deps, CTX, { entitlementId: ENT, targetRemaining: 5, note: 'Sayaç düzeltmesi' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.remaining).toBe(5)
    // The grant is still 8 — this is the whole point.
    expect(now().productSnapshot.entryAllowance).toBe(8)
    expect(entriesUsed(now().entryLedger)).toBe(3)
  })

  it('writes ONE event per entry given back, not one lump', async () => {
    // Three restores are three facts. A single "3 restored" event would lose when each was decided.
    const { deps, saved } = fakeDeps(entitlement(8, 5))
    await adjustEntries(deps, CTX, { entitlementId: ENT, targetRemaining: 6, note: 'Düzeltme' })
    expect(saved).toHaveLength(3)
  })

  it('a no-op is not an error, and writes nothing', async () => {
    const { deps, saved } = fakeDeps(entitlement(8, 5))
    const r = await adjustEntries(deps, CTX, { entitlementId: ENT, targetRemaining: 3, note: 'Düzeltme' })
    expect(r.ok).toBe(true)
    expect(saved).toHaveLength(0)
  })

  it('lowers the remainder into REVOKED, never into consumed', async () => {
    // The distinction the whole ledger rests on: `consumed` means a door took it. An admin taking one
    // away is a different fact, and keeping them apart is what lets the studio still answer "how many
    // times did she actually come?" after a correction. The credit ledger has always done this; the
    // entry meter had no such bucket until the desk needed to lower a number and there was nowhere
    // honest to put it.
    const { deps, now } = fakeDeps(entitlement(8, 2))
    const r = await adjustEntries(deps, CTX, { entitlementId: ENT, targetRemaining: 5, note: 'Düzeltme' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.remaining).toBe(5)
    expect(now().entryLedger.consumed).toBe(2) // the two real visits are untouched
    expect(now().entryLedger.revoked).toBe(1)
    expect(now().productSnapshot.entryAllowance).toBe(8)
  })

  it('refuses to take away more than she has left — never a negative remainder', async () => {
    const { deps, saved } = fakeDeps(entitlement(8, 8))
    const r = await adjustEntries(deps, CTX, { entitlementId: ENT, targetRemaining: 0, note: 'Düzeltme' })
    expect(r.ok).toBe(true) // already 0 left — nothing to do
    expect(saved).toHaveLength(0)
  })

  it('refuses a target above the package itself', async () => {
    const { deps } = fakeDeps(entitlement(8, 5))
    const r = await adjustEntries(deps, CTX, { entitlementId: ENT, targetRemaining: 9, note: 'Düzeltme' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_amount')
  })

  it('an UNLIMITED membership has no meter to correct', async () => {
    const { deps } = fakeDeps(entitlement(null, 0))
    const r = await adjustEntries(deps, CTX, { entitlementId: ENT, targetRemaining: 3, note: 'Düzeltme' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('operation_not_applicable')
  })
})
