import { describe, expect, it } from 'vitest'

import { instant, instantFromLocalDate, money, type CorrelationId, type EntitlementId, type MemberId, type ProductId, type StudioId } from '../../../shared'
import { decideBackdatedFreeze, type BackdatedFreeze } from './decide'
import type { Entitlement } from './types'

// A FREEZE THAT STARTED IN THE PAST (owner, 2026-10-19): *"geçmiş tarihli dondurma yapmak istiyoruz."*
// It is an ordinary freeze with an earlier start — and, when the window is already over, its end in
// the same write. What must hold: the date moves by exactly the days frozen, and the refusals.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_1' as never },
  now: instant(1_792_400_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const TRT = (d: string) => instantFromLocalDate(d, 180)!
const DAY = 24 * 60 * 60 * 1000
const TODAY = '2026-10-19'
const VALID_UNTIL = TRT('2027-01-08')

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  id: 'ent_1' as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1' as MemberId,
  productId: 'prd_fitness3' as ProductId,
  productSnapshot: {
    productId: 'prd_fitness3' as ProductId,
    name: 'Fitness 3 Ay',
    category: 'fitness',
    grant: { kind: 'period', durationDays: 90, access: 'unlimited' },
    listPrice: money(300_000),
  },
  policyRef: { policyId: 'prd_fitness3', version: 1 },
  status: 'active',
  validFrom: instant(TRT('2026-10-10')),
  validUntil: instant(VALID_UNTIL),
  credits: null,
  freeze: { entitledDays: 7, usedDays: 0, periods: [], activeFrom: null },
  cancellationLedger: { used: 0, refunded: 0 },
  entryLedger: { consumed: 0, restored: 0 },
  priceAgreed: money(300_000),
  paidTotal: money(300_000),
  manualPayment: null,
  purchasedAt: instant(TRT('2026-10-10')),
  ...over,
})

const plan = (from: string, to: string, over: Partial<BackdatedFreeze> = {}): BackdatedFreeze => ({
  from, to, fromAt: TRT(from), plannedDays: 0, reason: 'diger', note: null, ...over,
})
const decide = (p: BackdatedFreeze, e = ent(), activity = false, reservation = false) =>
  decideBackdatedFreeze(ctx, e, TODAY, activity, reservation, p)

describe('decideBackdatedFreeze — a window already over', () => {
  it('freezes and ends in one write; the date moves by exactly the days frozen', () => {
    const r = decide(plan('2026-10-11', '2026-10-17'))
    if (!r.ok) throw new Error(r.error.code)
    expect(r.value.events.map((e) => e.type)).toEqual(['entitlement.frozen', 'entitlement.unfrozen'])
    expect(r.value.next.status).toBe('active')
    expect(r.value.next.validUntil).toBe(VALID_UNTIL + 6 * DAY)
    expect(r.value.next.freeze?.usedDays).toBe(6)
    expect(r.value.next.freeze?.periods).toEqual([{ from: '2026-10-11', to: '2026-10-17' }])
  })

  it('a window ending TODAY is over too — she is back today', () => {
    const r = decide(plan('2026-10-12', TODAY))
    if (!r.ok) throw new Error(r.error.code)
    expect(r.value.next.status).toBe('active')
    expect(r.value.next.validUntil).toBe(VALID_UNTIL + 7 * DAY)
  })
})

describe('decideBackdatedFreeze — a window still running', () => {
  it('stays frozen from the past date; the sweep ends it on `to`', () => {
    const r = decide(plan('2026-10-15', '2026-10-21'))
    if (!r.ok) throw new Error(r.error.code)
    expect(r.value.events.map((e) => e.type)).toEqual(['entitlement.frozen'])
    expect(r.value.next.status).toBe('frozen')
    expect(r.value.next.freeze?.activeFrom).toBe('2026-10-15')
    expect(r.value.next.freeze?.plannedUntil).toBe('2026-10-21')
    expect(r.value.next.validUntil).toBe(VALID_UNTIL) // paid at unfreeze, as always
  })
})

describe('decideBackdatedFreeze — refused', () => {
  it.each([
    ['a start of today', plan(TODAY, '2026-10-25'), 'freeze_start_not_past'],
    ['a start in the future', plan('2026-10-20', '2026-10-25'), 'freeze_start_not_past'],
    ['a start before the package began', plan('2026-10-09', '2026-10-12'), 'freeze_before_package_start'],
    ['an end on the start', plan('2026-10-12', '2026-10-12'), 'invalid_freeze_days'],
    ['more days than she has, without initiative', plan('2026-10-11', '2026-10-19'), 'freeze_days_exceed_budget'],
    ['initiative without a reason', plan('2026-10-11', '2026-10-19', { override: true }), 'freeze_override_reason_required'],
  ] as const)('%s', (_, p, code) => {
    const r = decide(p)
    expect(r.ok ? 'ok' : r.error.code).toBe(code)
  })

  it("the package's first day is allowed — the boundary is the start, not the day after", () => {
    expect(decide(plan('2026-10-10', '2026-10-12')).ok).toBe(true)
  })

  it('a window she was seen in', () => {
    const r = decide(plan('2026-10-11', '2026-10-17'), ent(), true)
    expect(r.ok ? 'ok' : r.error.code).toBe('freeze_window_has_activity')
  })

  it('a booked class still inside the window', () => {
    const r = decide(plan('2026-10-15', '2026-10-21'), ent(), false, true)
    expect(r.ok ? 'ok' : r.error.code).toBe('freeze_blocked_by_reservation')
  })

  it('a package already frozen, or with a window booked', () => {
    const frozen = decide(plan('2026-10-11', '2026-10-17'), ent({ status: 'frozen' }))
    expect(frozen.ok ? 'ok' : frozen.error.code).toBe('entitlement_already_frozen')
    const booked = decide(plan('2026-10-11', '2026-10-17'), ent({ freeze: { entitledDays: 7, usedDays: 0, periods: [], activeFrom: null, scheduledFrom: '2026-11-01' } as never }))
    expect(booked.ok ? 'ok' : booked.error.code).toBe('freeze_already_scheduled')
  })

  it('initiative past the allowance, explained, goes through and pays the approved days', () => {
    const r = decide(plan('2026-10-11', '2026-10-19', { override: true, overrideReason: 'owner onayı' }))
    if (!r.ok) throw new Error(r.error.code)
    expect(r.value.next.validUntil).toBe(VALID_UNTIL + 8 * DAY)
  })
})
