import { describe, expect, it } from 'vitest'

import { instant, money, type CorrelationId, type EntitlementId, type MemberId, type ProductId, type StudioId } from '../../../shared'
import { decideFreeze, decideUnfreeze, freezeDaysRemaining } from './decide'
import type { Entitlement, FreezeState } from './types'

// FREEZE (v1.27 S3 · owner, 2026-07-13 · closes DEBT-009).
//
// The arithmetic the owner settled, and the two rules that make it safe:
//
//   • the membership is extended **when it is unfrozen**, by the days it actually stood still;
//   • the budget is a **ceiling the system enforces**, because an unlimited freeze is an unlimited
//     membership sold at the price of a three-month one.
//
// Nothing in this file knows the number seven. The budget is `product.freezeAllowanceDays`, copied
// onto the entitlement at purchase — data, as the catalogue always was (#12).

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist' as const, id: 'usr_1' as never },
  now: instant(1_768_468_800_000), // 2026-01-15T09:00:00Z
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const systemCtx = { ...ctx, actor: { type: 'system' as const, id: 'expire_credits' as never } }

// 01 Ocak – 01 Nisan (the owner's own example).
const VALID_UNTIL = instant(1_774_915_200_000) // 2026-04-01T00:00:00Z
const DAY = 24 * 60 * 60 * 1000

const freeze = (over: Partial<FreezeState> = {}): FreezeState => ({
  entitledDays: 7, // Fitness 3 ay → 1 hafta
  usedDays: 0,
  periods: [],
  activeFrom: null,
  ...over,
})

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
  validFrom: instant(1_767_225_600_000), // 2026-01-01
  validUntil: VALID_UNTIL,
  credits: null,
  freeze: freeze(),
  cancellationLedger: { used: 0, refunded: 0 },
    entryLedger: { consumed: 0, restored: 0 },
  priceAgreed: money(300_000),
  paidTotal: money(300_000),
  manualPayment: null,
  purchasedAt: instant(1_767_225_600_000),
  ...over,
})

// These tests predate freeze PLANS (2026-07-28) and are about the other rules — budget,
// reservations, product terms. A plain plan keeps each of them saying what it always said.
// Generous enough that none of these scenarios hits the plan — they are about the OTHER rules.
const PLAN = { plannedDays: 7, reason: 'tatil' as const, note: null }

describe('the owner’s example, exactly', () => {
  it('frozen on the 10th, unfrozen on the 15th → validUntil += 5 days', () => {
    const frozen = decideFreeze(ctx, ent(), '2026-01-10', false, PLAN)
    expect(frozen.ok).toBe(true)
    if (!frozen.ok) return
    // Freezing moves NO date: at freeze time nobody knows how long it will last, and a system that
    // guessed would have to un-guess later — in her favour, or against it.
    expect(frozen.value.next.validUntil).toBe(VALID_UNTIL)
    expect(frozen.value.next.status).toBe('frozen')

    const thawed = decideUnfreeze(ctx, frozen.value.next, '2026-01-15', false)
    expect(thawed.ok).toBe(true)
    if (!thawed.ok) return

    expect(thawed.value.next.validUntil).toBe(instant((VALID_UNTIL as number) + 5 * DAY))
    expect(thawed.value.next.status).toBe('active')
    expect(thawed.value.next.freeze?.usedDays).toBe(5)
    expect(thawed.value.next.freeze?.periods).toEqual([{ from: '2026-01-10', to: '2026-01-15' }])
    expect(freezeDaysRemaining(thawed.value.next.freeze!)).toBe(2) // 7 − 5
  })

  it('the unfreeze event carries the date that MOVED, before and after', () => {
    const frozen = decideFreeze(ctx, ent(), '2026-01-10', false, PLAN)
    if (!frozen.ok) return
    const thawed = decideUnfreeze(ctx, frozen.value.next, '2026-01-15', false)
    if (!thawed.ok) return

    const p = thawed.value.events[0]?.payload as Record<string, unknown>
    // She is judged by this date. A date that changed with no record is a date she can dispute and
    // we cannot defend (AD-19).
    expect(p.validUntilBefore).toBe(VALID_UNTIL as number)
    expect(p.validUntilAfter).toBe((VALID_UNTIL as number) + 5 * DAY)
    expect(p.days).toBe(5)
    expect(p.auto).toBe(false)
  })
})

describe('the budget is a CEILING, and the system enforces it', () => {
  it('a member frozen for TEN days on a seven-day budget is extended by SEVEN', () => {
    // She bought a week. She gets a week. *An unlimited freeze is an unlimited membership, sold at
    // the price of a three-month one.* (The sweep normally ends it on day seven; this cap is the
    // second line of defence, for the day the sweep did not run.)
    const frozen = decideFreeze(ctx, ent(), '2026-01-10', false, PLAN)
    if (!frozen.ok) return

    const thawed = decideUnfreeze(ctx, frozen.value.next, '2026-01-20', true) // ten days later
    expect(thawed.ok).toBe(true)
    if (!thawed.ok) return

    expect(thawed.value.next.validUntil).toBe(instant((VALID_UNTIL as number) + 7 * DAY))
    expect(thawed.value.next.freeze?.usedDays).toBe(7)
    expect(freezeDaysRemaining(thawed.value.next.freeze!)).toBe(0)
  })

  it('marks an automatic unfreeze as automatic — nobody asked for it', () => {
    const frozen = decideFreeze(ctx, ent(), '2026-01-10', false, PLAN)
    if (!frozen.ok) return
    const thawed = decideUnfreeze(systemCtx, frozen.value.next, '2026-01-17', true)
    if (!thawed.ok) return

    // The audit must not read as though a human made this decision.
    expect((thawed.value.events[0]?.payload as { auto: boolean }).auto).toBe(true)
    expect(thawed.value.events[0]?.actor).toEqual({ type: 'system', id: 'expire_credits' })
  })

  it('refuses a SECOND freeze once the budget is spent', () => {
    const spent = ent({ freeze: freeze({ usedDays: 7 }) })
    expect(decideFreeze(ctx, spent, '2026-02-01', false, PLAN)).toEqual({
      ok: false,
      error: { code: 'freeze_budget_exhausted' },
    })
  })

  it('but ALLOWS a second freeze while budget remains, and caps it at what is left', () => {
    const partly = ent({ freeze: freeze({ usedDays: 5, periods: [{ from: '2026-01-10', to: '2026-01-15' }] }) })
    // Two days left, so two days is what may be planned (2026-07-28).
    const frozen = decideFreeze(ctx, partly, '2026-02-01', false, { ...PLAN, plannedDays: 2 })
    expect(frozen.ok).toBe(true)
    if (!frozen.ok) return

    // Two days left; she stays frozen for five. She is extended by two.
    const thawed = decideUnfreeze(ctx, frozen.value.next, '2026-02-06', false)
    if (!thawed.ok) return
    expect(thawed.value.next.validUntil).toBe(instant((VALID_UNTIL as number) + 2 * DAY))
    expect(thawed.value.next.freeze?.usedDays).toBe(7)
  })
})

// ── The plan (owner, 2026-07-28) ──────────────────────────────────────────────────────────────
// A freeze used to run until somebody lifted it, so nobody could say when she was coming back.
describe('the freeze plan', () => {
  it('records the planned return date and the reason', () => {
    const r = decideFreeze(ctx, ent(), '2026-01-10', false, { plannedDays: 5, reason: 'saglik', note: 'ameliyat' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.freeze?.plannedUntil).toBe('2026-01-15')
    expect(r.value.next.freeze?.reason).toBe('saglik')
    // The human's words live on STATE, where an erasure can reach them.
    expect(r.value.next.freeze?.note).toBe('ameliyat')
  })

  // #6 — the log is permanent, and "ameliyat oldu" in a permanent record is health data nobody can
  // take back out. The enum is analysable; the sentence is erasable.
  it('puts the ENUM in the event and the free text nowhere near it', () => {
    const r = decideFreeze(ctx, ent(), '2026-01-10', false, { plannedDays: 5, reason: 'saglik', note: 'ameliyat oldu' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const payload = JSON.stringify(r.value.events[0]?.payload)
    expect(payload).toContain('saglik')
    expect(payload).not.toContain('ameliyat')
  })

  // Refused, never clamped: freezing for two days when reception asked for ten is the studio
  // quietly not doing what it said.
  it('REFUSES more days than she has left, rather than shortening it silently', () => {
    const partly = ent({ freeze: freeze({ usedDays: 5, periods: [{ from: '2026-01-10', to: '2026-01-15' }] }) })
    const r = decideFreeze(ctx, partly, '2026-02-01', false, { ...PLAN, plannedDays: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('freeze_days_exceed_budget')
  })

  it('REFUSES zero and fractional days', () => {
    for (const d of [0, -1, 2.5]) {
      const r = decideFreeze(ctx, ent(), '2026-01-10', false, { ...PLAN, plannedDays: d })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('invalid_freeze_days')
    }
  })

  it('allows exactly the whole remaining budget', () => {
    expect(decideFreeze(ctx, ent(), '2026-01-10', false, { ...PLAN, plannedDays: 7 }).ok).toBe(true)
  })
})

describe('what it refuses, and why nothing is fixed silently', () => {
  it('REFUSES a member with an upcoming booking — and does not cancel it for her', () => {
    // Cancelling her class would move a credit she never asked us to move, and she would find out
    // from a ledger rather than from us. The domain says no; the screen says why.
    expect(decideFreeze(ctx, ent(), '2026-01-10', true, PLAN)).toEqual({
      ok: false,
      error: { code: 'freeze_blocked_by_reservation' },
    })
  })

  it('REFUSES a package with no freeze allowance — Pilates has none, and that is the product’s terms', () => {
    const pilates = ent({ freeze: null })
    expect(decideFreeze(ctx, pilates, '2026-01-10', false, PLAN)).toEqual({
      ok: false,
      error: { code: 'freeze_not_allowed' },
    })

    const zero = ent({ freeze: freeze({ entitledDays: 0 }) })
    expect(decideFreeze(ctx, zero, '2026-01-10', false, PLAN).ok).toBe(false)
  })

  it('refuses to freeze a frozen package, and to unfreeze one that is not', () => {
    const frozen = decideFreeze(ctx, ent(), '2026-01-10', false, PLAN)
    if (!frozen.ok) return

    expect(decideFreeze(ctx, frozen.value.next, '2026-01-11', false, PLAN)).toEqual({
      ok: false,
      error: { code: 'entitlement_already_frozen' },
    })
    expect(decideUnfreeze(ctx, ent(), '2026-01-15', false)).toEqual({
      ok: false,
      error: { code: 'entitlement_not_frozen' },
    })
  })

  it('a freeze and an unfreeze on the SAME day costs nothing', () => {
    // She changed her mind. Zero days is zero days, and her membership does not move.
    const frozen = decideFreeze(ctx, ent(), '2026-01-10', false, PLAN)
    if (!frozen.ok) return
    const thawed = decideUnfreeze(ctx, frozen.value.next, '2026-01-10', false)
    if (!thawed.ok) return

    expect(thawed.value.next.validUntil).toBe(VALID_UNTIL)
    expect(thawed.value.next.freeze?.usedDays).toBe(0)
  })
})
