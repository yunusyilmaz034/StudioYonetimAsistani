import { describe, expect, it } from 'vitest'

import { applyIncrement, emptyDaily, incrementTargets, projectDaily, type ProjectableEvent } from './daily'
import { instant } from '../../../shared'

// The day boundary is where a dashboard quietly lies, so it is the first thing tested.
// Instants are written out by hand: `domain/` may not touch `Date`, not even in a test — the rule
// exists so a decision function can never read a hidden clock, and a test that needs an exception
// is usually a test that is about to prove the wrong thing.
const H = 3_600_000
const BASE = 1_783_900_800_000 // 2026-07-13T00:00:00Z
const at = (hoursUtc: number): ProjectableEvent['occurredAt'] => instant(BASE + hoursUtc * H)
const OFFSET = 180

const ev = (type: string, hoursUtc: number, payload: Record<string, unknown> = {}): ProjectableEvent => ({
  type,
  occurredAt: at(hoursUtc),
  payload,
})

describe('projectDaily (v1.23)', () => {
  it('puts an event in the STUDIO-LOCAL day, not the UTC one', () => {
    // 21:50 UTC on the 13th is 00:50 on the 14th in Istanbul.
    expect(projectDaily(ev('reservation.booked', 21.833333333333332), OFFSET)?.date).toBe('2026-07-14')
    // 22:30 local on the 13th (19:30 UTC) stays on the 13th.
    expect(projectDaily(ev('reservation.booked', 19.5), OFFSET)?.date).toBe('2026-07-13')
  })

  it('counts a booking, a cancellation and a check-in', () => {
    expect(projectDaily(ev('reservation.booked', 9.0), OFFSET)?.counters).toEqual({ bookings: 1 })
    expect(projectDaily(ev('reservation.late_cancelled', 9.0), OFFSET)?.counters).toEqual({ cancellations: 1 })
    expect(projectDaily(ev('member.checked_in', 9.0), OFFSET)?.counters).toEqual({ checkIns: 1 })
  })

  it('a MOVE is not a cancellation — it has its own counter (D19)', () => {
    const inc = projectDaily(ev('reservation.moved', 9.0), OFFSET)
    expect(inc?.counters).toEqual({ moves: 1 })
    expect(inc?.counters.cancellations).toBeUndefined()
  })

  it('a presumption is counted apart from an observation (#11)', () => {
    expect(projectDaily(ev('reservation.auto_resolved', 9.0), OFFSET)?.counters).toEqual({ autoResolved: 1 })
    expect(projectDaily(ev('reservation.attended', 9.0), OFFSET)?.counters).toEqual({ attended: 1 })
  })

  // Money is an object in the payload (#10). A projector that read it as a number would report
  // zero revenue forever, and nothing would crash.
  // ── The legacy money family is DEAD TO THE PROJECTION (v1.26) ──────────────────────────────
  //
  // Until v1.26 the projector folded BOTH families, and nothing was counted twice: a sale had
  // exactly one of them. **DEBT-021's migration generates a real `sale.created` for every legacy
  // purchase, from the same money** — so a projector that still folded the legacy events would
  // report **exactly double the revenue**, silently, on a dashboard the owner trusts.
  //
  // This was caught in v1.26's final verification, by a rebuild that printed 60.600 ₺ where the
  // studio had sold 30.300 ₺. It is the read side finally honouring the owner's decision: *migrate
  // once — do not carry a read-side `if (legacy)` forever* (Doc 26 §5).
  it('counts NO money from a legacy purchase — the migration gave it a sale, and the sale is counted', () => {
    const inc = projectDaily(
      ev('entitlement.purchased', 9.0, {
        priceAgreed: { amount: 500_000, currency: 'TRY' },
        productId: 'prd_1',
      }),
      OFFSET,
    )
    expect(inc.counters).toEqual({})
  })

  it('counts NO money from a legacy payment record', () => {
    const inc = projectDaily(
      ev('entitlement.payment_recorded', 9.0, {
        collectedAmount: { amount: 200_000, currency: 'TRY' },
      }),
      OFFSET,
    )
    expect(inc.counters).toEqual({})
  })

  it('counts NO money from a legacy cancellation', () => {
    const inc = projectDaily(
      ev('entitlement.cancelled', 177.0, {
        priceAgreed: { amount: 500_000, currency: 'TRY' },
        productId: 'prd_1',
        reason: 'x',
      }),
      OFFSET,
    )
    expect(inc.counters).toEqual({})
  })

  it('THE DOUBLE-COUNT: one sale, migrated, is counted exactly ONCE', () => {
    // The regression this rule exists for. Both events describe the SAME 5.000 ₺ — the legacy one
    // that v1.14 wrote, and the `sale.created` the migration generated from it, on the same day with
    // the same amount. Fold both and the owner's dashboard reports 10.000 ₺ she never took.
    const legacy = projectDaily(
      ev('entitlement.purchased', 9.0, {
        priceAgreed: { amount: 500_000, currency: 'TRY' },
        productId: 'prd_1',
      }),
      OFFSET,
    )
    const migrated = projectDaily(
      ev('sale.created', 9.0, { total: { amount: 500_000, currency: 'TRY' } }),
      OFFSET,
    )

    expect(legacy.counters).toEqual({})
    expect(migrated.counters).toEqual({ salesKurus: 500_000 })
  })

  // İNDİRİM SATIŞTAN DÜŞER (owner, 2026-09-16). 16 Eylül'de iki satış 18.800 ₺ açılıp hemen 16.000 ₺'ye indirildi;
  // pano 100.150 ₺, gün sonu raporu 94.550 ₺ dedi ve fark tam olarak iki indirimin toplamıydı — bu olay hiç
  // işlenmiyordu. Satış = ANLAŞILAN tutar; indirimden sonra anlaşılan tutar düşmüştür.
  it('sale.discounted, indirim kadar satışı düşürür', () => {
    const inc = projectDaily(
      ev('sale.discounted', 11.0, {
        totalBefore: { amount: 1_880_000, currency: 'TRY' },
        totalAfter: { amount: 1_600_000, currency: 'TRY' },
      }),
      OFFSET,
    )
    expect(inc.counters).toEqual({ salesKurus: -280_000 })
  })

  it('most of the catalogue moves no counter — a dashboard is not an archive', () => {
    expect(projectDaily(ev('product.updated', 9.0), OFFSET).counters).toEqual({})
    expect(projectDaily(ev('studio_calendar.day_marked', 9.0), OFFSET).counters).toEqual({})
  })

  // The bug this rule exists for (production, 2026-07-14). An event that moves no counter is still
  // SEEN: it lands on its day and advances `lastEventAt`. `projection_lag` compares the newest event
  // in the log against that watermark — so if an uncounted event were skipped, a day whose last event
  // was a settings change would read as further and further behind, and the alarm would scream for
  // ever about a projector that was perfectly healthy. An alarm nobody believes silences the real one.
  it('an uncounted event still lands on its day — the watermark is what the lag signal reads', () => {
    const inc = projectDaily(ev('product.updated', 9.0), OFFSET)
    const day = projectDaily(ev('reservation.booked', 9.0), OFFSET).date // the same day, counted
    expect(inc.date).toBe(day)

    const folded = applyIncrement(emptyDaily(day), inc, 1_700_000_000_000)
    expect(folded.lastEventAt).toBe(1_700_000_000_000) // seen…
    expect(folded.bookings).toBe(0) // …and counted nowhere
  })

  it('folding is additive and deterministic — the rebuild lands on the same numbers', () => {
    const events = [
      ev('reservation.booked', 9.0),
      ev('reservation.booked', 10.0),
      ev('reservation.cancelled', 11.0),
      ev('sale.created', 12.0, { total: { amount: 300_000, currency: 'TRY' }, productId: 'prd_1' }),
      ev('sale.created', 13.0, { total: { amount: 200_000, currency: 'TRY' }, productId: 'prd_1' }),
    ]
    const fold = () =>
      events.reduce((acc, e) => {
        const inc = projectDaily(e, OFFSET)
        return inc ? applyIncrement(acc, inc, e.occurredAt) : acc
      }, emptyDaily('2026-07-13'))

    const a = fold()
    const b = fold()
    expect(a).toEqual(b) // same input, same output — the rebuild's whole guarantee
    expect(a.bookings).toBe(2)
    expect(a.cancellations).toBe(1)
    expect(a.salesKurus).toBe(500_000)
    expect(a.salesByProduct).toEqual({ prd_1: 500_000 })
    expect(a.lastEventAt).toBe(at(13.0))
  })
})

// ── Excluding test accounts (owner, 2026-07-29) ──────────────────────────────────────────────
describe('excluded members', () => {
  const TEST_MEMBER = 'mem_test_1'
  const REAL_MEMBER = 'mem_real_1'
  const excluded = new Set([TEST_MEMBER])
  const sale = (memberId: string) => ({
    type: 'sale.created',
    occurredAt: at(108),
    payload: { total: { amount: 3_604_000, currency: 'TRY' }, productId: 'prd_x' },
    memberId,
  })

  it('counts nothing for an excluded member — the 36.040 ₺ that was never a sale', () => {
    const inc = projectDaily(sale(TEST_MEMBER), OFFSET, excluded)
    expect(inc.counters).toEqual({})
    expect(inc.productSales).toBeUndefined()
  })

  it('still SEES the event — the watermark must advance or the lag alarm lies', () => {
    // A projector that skips an event cannot be told apart from one that has died. The date is what
    // `applyOnce` writes the watermark against, so it has to be there.
    expect(projectDaily(sale(TEST_MEMBER), OFFSET, excluded).date).toBe('2026-07-17')
  })

  it('leaves a real member untouched', () => {
    expect(projectDaily(sale(REAL_MEMBER), OFFSET, excluded).counters).toEqual({ salesKurus: 3_604_000 })
  })

  it('excludes EVERYTHING, not just money — the owner said hepsi çıksın', () => {
    const attended = {
      type: 'reservation.attended',
      occurredAt: at(108),
      payload: {},
      memberId: TEST_MEMBER,
    }
    expect(projectDaily(attended, OFFSET, excluded).counters).toEqual({})
  })

  it('counts normally when no exclusion list is supplied — the default changes nothing', () => {
    expect(projectDaily(sale(TEST_MEMBER), OFFSET).counters).toEqual({ salesKurus: 3_604_000 })
  })

  it('ignores an event with no member at all', () => {
    const settings = { type: 'studio.settings_changed', occurredAt: at(108), payload: {} }
    expect(projectDaily(settings, OFFSET, excluded).counters).toEqual({})
  })
})

// (owner, 2026-10-08) Two payments of the 7th were voided on the 8th and the dashboard read
// "−21.500 ₺ collected today", while the till list had already taken them off the 7th.
describe('a void comes off the day the payment was RECEIVED', () => {
  const amount = { amount: 1_200_000, currency: 'TRY' }
  // Received 20:33 local on the 13th (17.55 UTC); voided 12:27 local on the 14th (33.45 UTC).
  const RECEIVED = at(17.55)
  const voided = (payload: Record<string, unknown>) => projectDaily(ev('payment.voided', 33.45, payload), OFFSET)

  it('charges the earlier day and leaves the day of the void untouched — but still SEEN', () => {
    const inc = voided({ amount, reason: 'x', method: 'cash', receivedAt: RECEIVED })
    // The event's own day carries no counter: the watermark moves there, the money does not.
    expect(inc.date).toBe('2026-07-14')
    expect(inc.counters).toEqual({})
    expect(inc.backdated).toEqual({ date: '2026-07-13', counters: { collectedKurus: -1_200_000 } })
  })

  it('a same-day void is one ordinary increment', () => {
    const inc = projectDaily(ev('payment.voided', 18.5, { amount, reason: 'x', method: 'cash', receivedAt: RECEIVED }), OFFSET)
    expect(inc).toEqual({ date: '2026-07-13', counters: { collectedKurus: -1_200_000 } })
  })

  it('the boundary is the STUDIO day: received 23:59 local, voided 00:01 local, are two days', () => {
    // 20:59 UTC on the 13th is 23:59 local; 21:01 UTC is 00:01 on the 14th.
    const inc = projectDaily(ev('payment.voided', 21 + 1 / 60, { amount, reason: 'x', method: 'cash', receivedAt: at(21 - 1 / 60) }), OFFSET)
    expect(inc.backdated?.date).toBe('2026-07-13')
    expect(inc.date).toBe('2026-07-14')
  })

  it('a void written BEFORE the field existed stays on the day of the void — nothing is invented', () => {
    expect(voided({ amount, reason: 'x', method: 'cash' })).toEqual({ date: '2026-07-14', counters: { collectedKurus: -1_200_000 } })
  })

  it('a REFUND is money that really left, and stays on the day it left', () => {
    const inc = projectDaily(ev('payment.refunded', 33.45, { amount, reason: 'x', receivedAt: RECEIVED }), OFFSET)
    expect(inc).toEqual({ date: '2026-07-14', counters: { collectedKurus: -1_200_000 } })
  })

  it('folds into both days, and only the day that SAW the event moves its watermark', () => {
    const inc = voided({ amount, reason: 'x', method: 'cash', receivedAt: RECEIVED })
    const days = new Map([
      ['2026-07-13', { ...emptyDaily('2026-07-13'), collectedKurus: 4_400_000, lastEventAt: 500 }],
      ['2026-07-14', { ...emptyDaily('2026-07-14'), collectedKurus: 0, lastEventAt: 900 }],
    ])
    for (const t of incrementTargets(inc, 1_000)) days.set(t.inc.date, applyIncrement(days.get(t.inc.date)!, t.inc, t.eventAt))
    expect(days.get('2026-07-13')).toMatchObject({ collectedKurus: 3_200_000, lastEventAt: 500 })
    expect(days.get('2026-07-14')).toMatchObject({ collectedKurus: 0, lastEventAt: 1_000 })
  })
})
