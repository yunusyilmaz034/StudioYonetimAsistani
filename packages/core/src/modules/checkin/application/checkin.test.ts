import { describe, expect, it } from 'vitest'

import { instant, money, type BranchId, type MemberId, type StudioId, type TenantContext } from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { CheckinDeps } from './ports'
import { recordCheckIn } from './checkin'

// WHY THIS FILE EXISTS.
//
// Spending a fitness serbest-giriş lived in `qr.ts`, copied three times, and the other two doors —
// reception's manual check-in and the turnstile — never called it. A member who does not scan a QR
// walked in for weeks and her meter never moved. Işıl found it by comparing the paper sheet with
// the screen: three visits on paper, zero deducted.
//
// The rule now lives in `recordCheckIn`, which every door goes through, so these tests cover all of
// them at once. That is the actual fix: not a fourth copy, but one room instead of three doors each
// deciding for itself.

const NOW = 1_800_000_000_000
const STUDIO = 'retro' as StudioId
const BRANCH = 'brn_1' as BranchId
const MEMBER = 'mem_1' as MemberId

const CTX = { studioId: STUDIO, branchIds: [BRANCH], role: 'owner', actor: { type: 'staff', id: 'stf_1' } } as unknown as TenantContext

const fitnessEnt = (allowance: number | null, consumed = 0): Entitlement =>
  ({
    id: 'ent_fit',
    studioId: STUDIO,
    memberId: MEMBER,
    productId: 'prd_1',
    productSnapshot: {
      productId: 'prd_1',
      name: 'Hibrit Aylık',
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
    entryLedger: { consumed, restored: 0 },
    priceAgreed: money(500_000),
    paidTotal: money(500_000),
    manualPayment: null,
    purchasedAt: instant(NOW - 86_400_000),
  }) as unknown as Entitlement

function fakeDeps(opts: { inside: boolean; ents: readonly Entitlement[]; dersiVar?: boolean }) {
  const saved: Entitlement[] = []
  const deps = {
    clock: { now: () => instant(NOW) },
    repo: {
      getBranch: async () => ({ branchId: BRANCH, isOpen: true, capacity: 50 }),
      getPresence: async () =>
        opts.inside ? { memberId: MEMBER, branchId: BRANCH, checkedInAt: instant(NOW - 3_600_000) } : null,
      countPresence: async () => 4,
      listCheckInsByMember: async () => [],
      applyCheckIn: async () => undefined,
    },
    entries: {
      listActiveByMember: async () => opts.ents,
      saveEntitlement: async (_c: TenantContext, e: Entitlement) => {
        saved.push(e)
      },
    },
    // Derse mi geldi, spora mı? (owner, 2026-08-26)
    classes: { hasClassAround: async () => opts.dersiVar === true },
  } as unknown as CheckinDeps
  return { deps, saved }
}

const entry = (method = 'manual') =>
  ({ memberId: MEMBER, branchId: BRANCH, method, occurredAt: instant(NOW), commandId: null }) as never

describe('recordCheckIn — the fitness meter moves at EVERY door', () => {
  it('a manual check-in spends an entry — the case that was broken', async () => {
    // Reception picks her from the list; no QR anywhere. This used to move nothing at all.
    const { deps, saved } = fakeDeps({ inside: false, ents: [fitnessEnt(5, 2)] })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.fitnessEntry).toEqual({ used: 3, allowance: 5 })
    expect(saved[0]?.entryLedger).toEqual({ consumed: 3, restored: 0 })
  })

  it('an EXIT spends nothing — leaving is not a visit', async () => {
    const { deps, saved } = fakeDeps({ inside: true, ents: [fitnessEnt(5, 2)] })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.direction).toBe('out')
      expect(r.value.fitnessEntry).toBeNull()
    }
    expect(saved).toHaveLength(0)
  })

  it('an UNLIMITED fitness membership spends nothing — it has no meter', async () => {
    const { deps, saved } = fakeDeps({ inside: false, ents: [fitnessEnt(null)] })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.fitnessEntry).toBeNull()
    expect(saved).toHaveLength(0)
  })

  it('holding BOTH limited and unlimited spends nothing — the unlimited one already lets her in', async () => {
    const { deps, saved } = fakeDeps({ inside: false, ents: [fitnessEnt(5), fitnessEnt(null)] })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.fitnessEntry).toBeNull()
    expect(saved).toHaveLength(0)
  })

  it('a member with no fitness package at all is untouched', async () => {
    const { deps, saved } = fakeDeps({ inside: false, ents: [] })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.fitnessEntry).toBeNull()
    expect(saved).toHaveLength(0)
  })

  it('a member arriving for her BOOKED CLASS spends no entry — the hybrid case', async () => {
    // Buse's complaint. A hybrid package grants gym entries AND pilates credits; walking in for the
    // pilates class used to burn a gym entry as well, so one visit cost her twice. The owner's rule:
    // "pilates rezervasyonu varsa kişi pilatese katılmıştır" — the meter is for the visits that are
    // NOT a class.
    const { deps, saved } = fakeDeps({ inside: false, ents: [fitnessEnt(6, 2)], dersiVar: true })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.fitnessEntry).toBeNull()
    expect(saved).toHaveLength(0)
  })

  it('the same member with NO class that hour spends an entry — she came for the gym', async () => {
    // The other half of the same rule, and the half that must not be lost: Buse checked in at 11:50
    // with her class at 17:00, and at 10:30 on a day with no class at all. Those two ARE gym visits
    // and the meter is right to move.
    const { deps, saved } = fakeDeps({ inside: false, ents: [fitnessEnt(6, 2)], dersiVar: false })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.fitnessEntry).toEqual({ used: 3, allowance: 6 })
    expect(saved).toHaveLength(1)
  })

  it('over-use is RECORDED, never refused — the door is not a bouncer', async () => {
    // Soft cap by design: saying "you have used 6 of 5" is the screen's job; turning her away at
    // the door is nobody's.
    const { deps, saved } = fakeDeps({ inside: false, ents: [fitnessEnt(5, 5)] })
    const r = await recordCheckIn(deps, CTX, entry())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.fitnessEntry).toEqual({ used: 6, allowance: 5 })
    expect(saved).toHaveLength(1)
  })
})
