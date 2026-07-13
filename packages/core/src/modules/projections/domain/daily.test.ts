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
    expect(inc).toBeNull()
  })

  it('counts NO money from a legacy payment record', () => {
    const inc = projectDaily(
      ev('entitlement.payment_recorded', 9.0, {
        collectedAmount: { amount: 200_000, currency: 'TRY' },
      }),
      OFFSET,
    )
    expect(inc).toBeNull()
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
    expect(inc).toBeNull()
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

    expect(legacy).toBeNull()
    expect(migrated?.counters).toEqual({ salesKurus: 500_000 })
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
