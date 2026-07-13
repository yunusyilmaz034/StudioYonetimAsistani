import type { Instant } from './time'

// Studio-level configuration.
//
// ── The timezone is IANA, and the offset is DERIVED (owner, 2026-07-13 · v1.27 S2) ──────────
//
// Until now this carried a fixed `utcOffsetMinutes: 180` (AD-52) — correct for Türkiye, which has
// been UTC+3 year-round since 2016, and a lie the moment a studio opens anywhere else. An offset is
// not a *fact about a place*; it is a fact about a place **at an instant**, and storing it throws
// away the only thing that can regenerate it.
//
// So: **`timeZone` is stored, `utcOffsetMinutes` is derived.** The pure functions — the projector,
// the recurring generator, the wall-clock→instant converter — still take a plain number, and they
// still should: they are answering "what day is this, locally?", and a number is the whole answer.
// What changed is where the number comes from.
export interface StudioConfig {
  /** IANA, e.g. `Europe/Istanbul`. The stored truth. */
  readonly timeZone: string
  /** DERIVED from `timeZone`. Never stored, never hand-set. */
  readonly utcOffsetMinutes: number
}

export const DEFAULT_TIME_ZONE = 'Europe/Istanbul'

/**
 * The UTC offset of a timezone **at an instant**. Pure and deterministic: the same zone and the same
 * instant always give the same answer, which is what lets a projection be rebuilt from the log and
 * land on the same numbers.
 *
 * `Intl` knows every zone's rules, including the ones that changed in 2016. We do not: a table of
 * offsets we maintain by hand is a table that is wrong in the year we stop looking at it.
 */
export function offsetMinutesAt(timeZone: string, at: Instant): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at))

  const at_ = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // What the wall clock in that zone reads, expressed as if it were UTC. The gap between that and
  // the real instant IS the offset.
  const asIfUtc = Date.UTC(
    at_('year'),
    at_('month') - 1,
    at_('day'),
    at_('hour') % 24, // `hour12: false` renders midnight as 24 in some ICU versions
    at_('minute'),
    at_('second'),
  )
  return Math.round((asIfUtc - at) / 60_000)
}

/** The config a pure function consumes, built from the stored zone. */
export function studioConfig(timeZone: string, at: Instant): StudioConfig {
  return { timeZone, utcOffsetMinutes: offsetMinutesAt(timeZone, at) }
}

// The fallback for a studio that has no settings yet — the first hour of its life, before the owner
// has opened the settings screen. It is NOT a second source of truth: a test asserts that its offset
// is exactly what `offsetMinutesAt(DEFAULT_TIME_ZONE, …)` returns, so the constant and the zone can
// never quietly disagree.
export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  timeZone: DEFAULT_TIME_ZONE,
  utcOffsetMinutes: 180, // Europe/Istanbul, UTC+3 — proven against the zone in studio-config.test.ts
}
