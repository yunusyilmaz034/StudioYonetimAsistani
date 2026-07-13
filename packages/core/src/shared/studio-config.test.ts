import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_CONFIG, DEFAULT_TIME_ZONE, offsetMinutesAt, studioConfig } from './studio-config'
import { instant } from './time'

// The timezone is stored; the offset is derived (v1.27 S2 · owner, 2026-07-13).
//
// An offset is not a fact about a place. It is a fact about a place **at an instant** — and storing
// it throws away the only thing that can regenerate it.

const JANUARY = instant(Date.parse('2026-01-15T12:00:00Z'))
const JULY = instant(Date.parse('2026-07-15T12:00:00Z'))

describe('Europe/Istanbul', () => {
  it('is UTC+3, all year — no DST since 2016', () => {
    expect(offsetMinutesAt('Europe/Istanbul', JANUARY)).toBe(180)
    expect(offsetMinutesAt('Europe/Istanbul', JULY)).toBe(180)
  })

  it('the DEFAULT constant cannot quietly disagree with its own zone', () => {
    // This is the test that makes the constant safe to keep. It is a *cache* of the derivation, not
    // a second source of truth — and a cache that nobody checks is a lie waiting for a summer.
    expect(DEFAULT_STUDIO_CONFIG.timeZone).toBe(DEFAULT_TIME_ZONE)
    expect(DEFAULT_STUDIO_CONFIG.utcOffsetMinutes).toBe(offsetMinutesAt(DEFAULT_TIME_ZONE, JULY))
    expect(DEFAULT_STUDIO_CONFIG.utcOffsetMinutes).toBe(offsetMinutesAt(DEFAULT_TIME_ZONE, JANUARY))
  })
})

describe('a zone that DOES observe DST — the case a stored offset gets wrong', () => {
  it('Europe/Berlin is +60 in winter and +120 in summer', () => {
    // The whole reason for this change. A studio in Berlin with a stored `utcOffsetMinutes: 60`
    // would, from the last Sunday in March, put every class an hour into the wrong day — quietly,
    // in the projection, on a dashboard nobody thought to doubt.
    expect(offsetMinutesAt('Europe/Berlin', JANUARY)).toBe(60)
    expect(offsetMinutesAt('Europe/Berlin', JULY)).toBe(120)
  })

  it('and a zone west of UTC is negative', () => {
    expect(offsetMinutesAt('America/New_York', JANUARY)).toBe(-300)
    expect(offsetMinutesAt('America/New_York', JULY)).toBe(-240)
  })
})

describe('studioConfig()', () => {
  it('derives the offset the pure functions consume', () => {
    // The projector, the recurring generator and the wall-clock converter still take a plain number,
    // and they still should: they are answering "what day is this, locally?", and a number is the
    // whole answer. What changed is where the number comes from.
    const cfg = studioConfig('Europe/Istanbul', JULY)
    expect(cfg).toEqual({ timeZone: 'Europe/Istanbul', utcOffsetMinutes: 180 })
  })

  it('is DETERMINISTIC — the same zone and instant always give the same answer', () => {
    // Which is what lets the projection be rebuilt from the log and land on exactly the same numbers.
    expect(studioConfig('Europe/Berlin', JULY)).toEqual(studioConfig('Europe/Berlin', JULY))
  })
})
