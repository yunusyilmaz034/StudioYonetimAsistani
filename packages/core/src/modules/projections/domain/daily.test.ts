import { describe, expect, it } from 'vitest'

import { applyIncrement, emptyDaily, projectDaily, type ProjectableEvent } from './daily'
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
  it('SATIŞ is the agreed price, even when nothing was paid (owner D-1)', () => {
    const inc = projectDaily(
      ev('entitlement.purchased', 9.0, { priceAgreed: { amount: 500_000, currency: 'TRY' }, productId: 'prd_1' }),
      OFFSET,
    )
    expect(inc?.counters).toEqual({ salesKurus: 500_000 })
    expect(inc?.productSales).toEqual({ productId: 'prd_1', amountKurus: 500_000 })
  })

  it('TAHSİLAT reads collectedAmount, never priceAgreed', () => {
    const inc = projectDaily(
      ev('entitlement.payment_recorded', 9.0, { collectedAmount: { amount: 200_000, currency: 'TRY' }, priceAgreed: { amount: 500_000, currency: 'TRY' } }),
      OFFSET,
    )
    expect(inc?.counters).toEqual({ collectedKurus: 200_000 })
  })

  it('a cancelled sale goes NET — subtracted on the day it is cancelled, never rewriting the past', () => {
    const inc = projectDaily(
      ev('entitlement.cancelled', 177.0, { priceAgreed: { amount: 500_000, currency: 'TRY' }, productId: 'prd_1', reason: 'x' }),
      OFFSET,
    )
    expect(inc?.date).toBe('2026-07-20') // NOT the purchase date
    expect(inc?.counters).toEqual({ salesKurus: -500_000 })
  })

  it('an old cancellation with no amount subtracts nothing (no backfill, no guessing)', () => {
    const inc = projectDaily(ev('entitlement.cancelled', 177.0, { reason: 'x' }), OFFSET)
    expect(inc?.counters).toEqual({ salesKurus: 0 })
  })

  it('most of the catalogue contributes nothing — a dashboard is not an archive', () => {
    expect(projectDaily(ev('product.updated', 9.0), OFFSET)).toBeNull()
    expect(projectDaily(ev('studio_calendar.day_marked', 9.0), OFFSET)).toBeNull()
  })

  it('folding is additive and deterministic — the rebuild lands on the same numbers', () => {
    const events = [
      ev('reservation.booked', 9.0),
      ev('reservation.booked', 10.0),
      ev('reservation.cancelled', 11.0),
      ev('entitlement.purchased', 12.0, { priceAgreed: { amount: 300_000, currency: 'TRY' }, productId: 'prd_1' }),
      ev('entitlement.purchased', 13.0, { priceAgreed: { amount: 200_000, currency: 'TRY' }, productId: 'prd_1' }),
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
