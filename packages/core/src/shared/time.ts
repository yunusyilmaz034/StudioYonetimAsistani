import type { Brand } from './brand'

// A point in time, UTC, as epoch milliseconds. All business rules read domain
// time; storage maps Firestore Timestamp ↔ Instant at the repo boundary (Doc 5).
export type Instant = Brand<number, 'Instant'>

// A calendar day in the studio's timezone, 'YYYY-MM-DD'. Freeze windows are
// LocalDate ranges; a cancellation window is an Instant difference. Keeping them
// distinct is what prevents the off-by-one-day bug that appears twice a year at
// DST boundaries (Doc 2 §12).
export type LocalDate = Brand<string, 'LocalDate'>

const MS_PER_HOUR = 3_600_000

export function instant(epochMs: number): Instant {
  if (!Number.isFinite(epochMs)) {
    throw new Error(`Instant must be a finite epoch-ms number, got ${epochMs}`)
  }
  return epochMs as Instant
}

export const instantFromISO = (iso: string): Instant => instant(Date.parse(iso))

export const toISO = (i: Instant): string => new Date(i).toISOString()

export const hoursBetween = (from: Instant, to: Instant): number => (to - from) / MS_PER_HOUR

// Domain time (`occurredAt`) may be client-supplied — an offline mark carries the
// instant it actually happened. It is ALWAYS clamped so it can never be in the
// future relative to the server clock (non-negotiable #3): a device with a fast
// clock must not stamp an event ahead of `recordedAt`.
export const clampOccurredAt = (occurredAt: Instant, now: Instant): Instant =>
  instant(Math.min(occurredAt, now))

export const isBefore = (a: Instant, b: Instant): boolean => a < b
export const isAfter = (a: Instant, b: Instant): boolean => a > b

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function localDate(value: string): LocalDate {
  if (!LOCAL_DATE_RE.test(value)) {
    throw new Error(`LocalDate must be 'YYYY-MM-DD', got ${value}`)
  }
  return value as LocalDate
}

// The studio-local calendar day an instant falls on. PURE ARITHMETIC — no `Date`, because this
// is called from `domain/`, where a hidden clock read is a build failure (D2). Days-from-epoch →
// civil date (Howard Hinnant's algorithm); Istanbul has no DST, so a fixed offset is exact.
export function localDateAt(at: Instant, utcOffsetMinutes: number): LocalDate {
  const days = Math.floor((at + utcOffsetMinutes * 60_000) / 86_400_000)
  const z = days + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const year = m <= 2 ? y + 1 : y
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  return `${year}-${pad(m)}-${pad(d)}` as LocalDate
}

// ── Pure calendar arithmetic on LocalDates (v1.27 S3) ────────────────────────────────────────
//
// `Date` is banned in `domain/` — a decision function that reads a clock cannot be exhaustively
// tested — and the freeze arithmetic needs to count days between two calendar dates. So it counts
// them the way calendars actually work: integer arithmetic, no timezone, no Date, no surprises.
//
// Howard Hinnant's days-from-civil. It is exact for every date, and it does not care what hour it is
// anywhere: a day is a day.
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146_097 + doe - 719_468
}

const parseLocalDate = (d: string): number => {
  const [y, m, day] = d.split('-').map(Number)
  return daysFromCivil(y ?? 1970, m ?? 1, day ?? 1)
}

/** Whole days between two `YYYY-MM-DD` dates. `daysBetween('2026-01-10', '2026-01-15')` is 5. */
export function daysBetween(from: string, to: string): number {
  return parseLocalDate(to) - parseLocalDate(from)
}

/** `YYYY-MM-DD`, `n` days after `from`. Pure: no Date, no timezone, no drift. */
export function addLocalDays(from: string, n: number): string {
  const z = parseLocalDate(from) + n + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const year = m <= 2 ? y + 1 : y
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
