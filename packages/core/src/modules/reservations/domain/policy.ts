import type { HourRange, ReservationOverride } from '../../../shared'

// ── The reservation policy resolver (Plus Phase 3) ──────────────────────────────────────────
//
// One place resolves "what rule applies to THIS booking?" — studio default → package rule → member
// override, most specific wins. Every path (book, quick-book, bulk, recurring, waitlist-promote)
// reads the SAME resolved value, so the same member is judged the same way on every screen. The
// resolver is pure data: no counts, no clock, no I/O.
//
// A field is tri-state (see ReservationOverride): the override's value if it SAID anything
// (undefined ⇒ inherit), else the package's. There is no studio default for these limits yet —
// absent everywhere ⇒ null ⇒ unlimited, the behaviour-preserving default.

export interface PackageRule {
  readonly cancellationAllowanceCount: number | null
  readonly dailyReservationLimit: number | null
  readonly activeReservationLimit: number | null
}

export interface EffectiveReservationPolicy {
  readonly cancellationAllowance: number | null // null ⇒ unlimited
  readonly dailyReservationLimit: number | null
  readonly activeReservationLimit: number | null
  readonly allowedWeekdays: readonly number[] | null // null ⇒ all days
  readonly allowedHourRanges: readonly HourRange[] | null // null ⇒ all hours
  readonly allowedTrainerIds: readonly string[] | null // Plus Phase 4 — null ⇒ any trainer
}

const pick = (o: number | null | undefined, p: number | null): number | null => (o !== undefined ? o : p)

export function resolveReservationPolicy(
  pkg: PackageRule,
  override: ReservationOverride | null,
): EffectiveReservationPolicy {
  return {
    cancellationAllowance: pick(override?.cancellationAllowance, pkg.cancellationAllowanceCount),
    dailyReservationLimit: pick(override?.dailyReservationLimit, pkg.dailyReservationLimit),
    activeReservationLimit: pick(override?.activeReservationLimit, pkg.activeReservationLimit),
    allowedWeekdays: override?.allowedWeekdays ?? null,
    allowedHourRanges: override?.allowedHourRanges ?? null,
    allowedTrainerIds: override?.allowedTrainerIds ?? null,
  }
}

// The package rule as frozen on the entitlement's product snapshot (allowance fields optional; an
// absent field ⇒ a pre-Phase-3 purchase ⇒ unlimited).
export function packageRuleFromSnapshot(snap: {
  readonly cancellationAllowanceCount?: number | null
  readonly dailyReservationLimit?: number | null
  readonly activeReservationLimit?: number | null
}): PackageRule {
  return {
    cancellationAllowanceCount: snap.cancellationAllowanceCount ?? null,
    dailyReservationLimit: snap.dailyReservationLimit ?? null,
    activeReservationLimit: snap.activeReservationLimit ?? null,
  }
}

// Studio-local weekday (0=Sunday … 6=Saturday) and minute-of-day for an Instant, by pure arithmetic —
// `new Date` is banned in domain/ (non-determinism) and unnecessary: epoch ms 0 is Thursday (=4).
export function localWeekday(ms: number, offsetMinutes: number): number {
  const dayNum = Math.floor((ms + offsetMinutes * 60_000) / 86_400_000)
  return ((((dayNum + 4) % 7) + 7) % 7)
}
export function localMinuteOfDay(ms: number, offsetMinutes: number): number {
  const shifted = ms + offsetMinutes * 60_000
  const inDay = ((shifted % 86_400_000) + 86_400_000) % 86_400_000
  return Math.floor(inDay / 60_000)
}
