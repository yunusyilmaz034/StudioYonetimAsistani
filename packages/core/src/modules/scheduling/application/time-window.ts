import { instant, localDate, type Instant, type LocalDate, type StudioConfig } from '../../../shared'
import type { Weekday } from '../domain/types'

// Wall-clock → UTC lives in the application, never the domain (AD-52). Templates
// are LocalDate + 'HH:MM'; the studio's fixed offset produces the UTC Instant.
const MS_PER_MIN = 60_000
const MS_PER_DAY = 86_400_000

function ymd(date: LocalDate): [number, number, number] {
  const [y, m, d] = date.split('-') as [string, string, string]
  return [Number(y), Number(m), Number(d)]
}

function hm(time: string): [number, number] {
  const [h, m] = time.split(':') as [string, string]
  return [Number(h), Number(m)]
}

export function localSlotToInstant(
  date: LocalDate,
  time: string,
  durationMinutes: number,
  config: StudioConfig,
): { startsAt: Instant; endsAt: Instant } {
  const [y, m, d] = ymd(date)
  const [hh, mm] = hm(time)
  // Treat the wall-clock as UTC, then shift back by the studio offset to real UTC.
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  const startsMs = wall - config.utcOffsetMinutes * MS_PER_MIN
  return {
    startsAt: instant(startsMs),
    endsAt: instant(startsMs + durationMinutes * MS_PER_MIN),
  }
}

function toLocalDate(y: number, m: number, d: number): LocalDate {
  const p = (n: number) => String(n).padStart(2, '0')
  return localDate(`${y}-${p(m)}-${p(d)}`)
}

// The studio-local calendar date of an instant (for the generation window start).
export function localDateOf(at: Instant, config: StudioConfig): LocalDate {
  const shifted = new Date(at + config.utcOffsetMinutes * MS_PER_MIN)
  return toLocalDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = ymd(date)
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY)
  return toLocalDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

function weekdayOf(date: LocalDate): number {
  const [y, m, d] = ymd(date)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function isOnOrBefore(a: LocalDate, b: LocalDate): boolean {
  return a <= b
}

// Every date in [from, to] falling on `dayOfWeek` (I-25 window).
export function occurrenceDates(dayOfWeek: Weekday, from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = []
  let cursor = from
  let guard = 0
  while (isOnOrBefore(cursor, to) && guard < 400) {
    if (weekdayOf(cursor) === dayOfWeek) dates.push(cursor)
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return dates
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b
}
export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b
}
