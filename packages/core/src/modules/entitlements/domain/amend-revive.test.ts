import { describe, expect, it } from 'vitest'

import { instant, instantFromLocalDate, money, type CorrelationId, type EntitlementId, type MemberId, type ProductId, type StudioId } from '../../../shared'
import { decideAmend } from './decide'
import type { Entitlement } from './types'

// MOVING AN EXPIRED PACKAGE'S END DATE FORWARD (owner, 2026-08-31).
//
// The owner extended two members' end dates to the 7th of September. Both stayed PASSIVE. The date
// moved and the status did not — and nothing else was ever going to move it: `decideReactivate`
// accepts only `cancelled` ("expired is terminal"), `decideExtend` refuses anything not active. The
// records contradicted themselves — expired, valid for another week — and two paying members could
// not book.
//
// The defect underneath was not the missing revival. It was that a save was accepted which produced
// a state no rule could produce and no screen could explain.

// Stüdyo saati UTC+3. `instantFromLocalDate` saf tamsayı aritmetiği — domain testinde `Date`
// yasaktır (D2) ve bu kural burada da geçerli.
const TRT = (d: string) => instantFromLocalDate(d, 180)!
const NOW = instant(TRT('2026-08-31') + 20 * 3_600_000) // 31 Ağustos 20:00 TRT
const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_1' as never },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const ent = (over: Partial<Entitlement> = {}): Entitlement =>
  ({
    id: 'ent_1' as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    productId: 'prd_1' as ProductId,
    productSnapshot: {
      productId: 'prd_1' as ProductId,
      name: 'Fitness - 3 Aylık',
      category: 'fitness',
      grant: { kind: 'period', durationDays: 90, access: 'unlimited' },
      listPrice: money(440_000),
    },
    policyRef: { policyId: 'prd_1', version: 1 },
    status: 'expired',
    validFrom: TRT('2026-06-02'),
    validUntil: TRT('2026-08-30'),
    credits: null,
    freeze: null,
    cancellationLedger: { used: 0, refunded: 0 },
    entryLedger: { consumed: 0, restored: 0 },
    priceAgreed: money(440_000),
    paidTotal: money(440_000),
    manualPayment: null,
    purchasedAt: TRT('2026-06-02'),
    ...over,
  }) as Entitlement

const YARIN = TRT('2026-09-07')

describe('a period package whose end date is moved into the future comes BACK', () => {
  it('goes from expired to active', () => {
    const r = decideAmend(ctx, ent(), { validUntil: YARIN }, 'uye tatildeydi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('active')
    expect(r.value.next.validUntil).toBe(YARIN)
  })

  it('records the revival as its OWN event, not a field inside the edit', () => {
    // "How often do we bring a lapsed membership back?" is a question somebody will ask. Folded into
    // an `amended` alongside price edits and typo fixes, it could never be separated again.
    const r = decideAmend(ctx, ent(), { validUntil: YARIN }, 'uye tatildeydi')
    if (!r.ok) return
    expect(r.value.events.map((e) => e.type)).toEqual(['entitlement.amended', 'entitlement.reactivated'])
    expect(r.value.events[0]!.payload).toMatchObject({ changedFields: ['validUntil', 'status'] })
  })

  it('does NOT revive when the new date is still in the past — a typo fix is not a revival', () => {
    const r = decideAmend(ctx, ent(), { validUntil: TRT('2026-08-15') }, 'tarih duzeltmesi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('expired')
    expect(r.value.events.map((e) => e.type)).toEqual(['entitlement.amended'])
  })

  it('heals a contradictory row even when the date was not what changed', () => {
    // The repair case: a row already left `expired` with a future date. Re-saving the same date is a
    // no-op patch, so a rule keyed on "did validUntil change?" would never fire and the row would
    // stay broken for ever.
    const bozuk = ent({ validUntil: YARIN })
    const r = decideAmend(ctx, bozuk, { validUntil: YARIN }, 'duzeltme')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('active')
    expect(r.value.events.map((e) => e.type)).toEqual(['entitlement.amended', 'entitlement.reactivated'])
  })

  it('does not touch an ACTIVE package’s status', () => {
    const r = decideAmend(ctx, ent({ status: 'active' }), { validUntil: YARIN }, 'uzatma')
    if (!r.ok) return
    expect(r.value.next.status).toBe('active')
    expect(r.value.events).toHaveLength(1)
  })

  it('does not revive a CANCELLED one — cancelling was a decision, and it has its own undo', () => {
    const r = decideAmend(ctx, ent({ status: 'cancelled' }), { validUntil: YARIN }, 'tarih')
    if (!r.ok) return
    expect(r.value.next.status).toBe('cancelled')
  })
})

describe('a CREDIT package is refused, because its credits were burned', () => {
  const krediliBiten = ent({
    productSnapshot: {
      productId: 'prd_2' as ProductId,
      name: 'Reformer Pilates - 8 Ders',
      category: 'pilates_group',
      grant: { kind: 'credits', credits: 8, validForDays: 30 },
      listPrice: money(500_000),
    },
    // Expiry moved the three unused credits into `expired` — available is now zero.
    credits: { granted: 8, held: 0, consumed: 5, restored: 0, revoked: 0, expired: 3 },
  } as Partial<Entitlement>)

  it('refuses rather than producing an "active" package with nothing in it', () => {
    // Moving the date alone would look fixed and be empty — worse than the refusal, because the
    // owner would stop looking.
    const r = decideAmend(ctx, krediliBiten, { validUntil: YARIN }, 'uzatalim')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('expired_credits_cannot_revive')
  })

  it('still allows editing OTHER fields on it — the refusal is about reviving, not about editing', () => {
    const r = decideAmend(ctx, krediliBiten, { priceAgreed: money(400_000) }, 'fiyat duzeltmesi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('expired')
  })
})
