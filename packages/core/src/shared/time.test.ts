import { describe, expect, it } from 'vitest'

import { hoursBetween, instant, instantFromISO, isAfter, isBefore, localDate, toISO } from './time'

describe('time', () => {
  it('computes hours between instants, boundary-exact', () => {
    const t0 = instant(0)
    const sixHours = instant(6 * 3_600_000)
    // exactly 6h is 6.0, not 5.99 — the cancellation-window boundary (Doc 6 §6)
    expect(hoursBetween(t0, sixHours)).toBe(6)
    expect(hoursBetween(sixHours, t0)).toBe(-6)
  })

  it('round-trips an ISO instant', () => {
    const iso = '2026-07-14T16:00:00.000Z'
    expect(toISO(instantFromISO(iso))).toBe(iso)
  })

  it('orders instants', () => {
    expect(isBefore(instant(1), instant(2))).toBe(true)
    expect(isAfter(instant(2), instant(1))).toBe(true)
    expect(isBefore(instant(2), instant(1))).toBe(false)
  })

  it('validates the LocalDate format and rejects everything else', () => {
    expect(localDate('2026-07-14')).toBe('2026-07-14')
    expect(() => localDate('2026/07/14')).toThrow()
    expect(() => localDate('14-07-2026')).toThrow()
    expect(() => localDate('2026-7-4')).toThrow()
  })
})
