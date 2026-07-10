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

export const isBefore = (a: Instant, b: Instant): boolean => a < b
export const isAfter = (a: Instant, b: Instant): boolean => a > b

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function localDate(value: string): LocalDate {
  if (!LOCAL_DATE_RE.test(value)) {
    throw new Error(`LocalDate must be 'YYYY-MM-DD', got ${value}`)
  }
  return value as LocalDate
}
