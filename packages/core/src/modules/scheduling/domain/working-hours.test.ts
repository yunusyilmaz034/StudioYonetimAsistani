import { describe, expect, it } from 'vitest'

import { instant, type LocalDate } from '../../../shared'
import type { WorkingHours } from './types'
import { checkWorkingHours } from './working-hours'

// AG-1 — the rule itself.
//
// Working hours were STORED from S2 and enforced NOWHERE: the form warned, the engine shrugged, and
// a class could be scheduled — and booked — at three in the morning. A setting that does nothing is
// worse than a setting that is absent, because the owner believes it.
//
// Europe/Istanbul, UTC+3, no DST. The offset is passed in, never assumed: this function is pure and
// does not know what country it is in.
const TR = 180

// 2024-01-01T00:00:00+03:00 was a MONDAY. Every instant below is built from it, so the weekday
// arithmetic is under test too — an off-by-one here would close the studio on the wrong day.
// 2024-01-01T00:00:00+03:00 — a MONDAY, in Istanbul. Written as an epoch literal because `Date` is
// banned in the domain (D2): a decision function that can read the clock cannot be exhaustively
// tested, and the ban holds for its tests too.
const MONDAY_MIDNIGHT = 1_704_056_400_000
const at = (dayOffset: number, hh: number, mm = 0) =>
  instant(MONDAY_MIDNIGHT + dayOffset * 86_400_000 + hh * 3_600_000 + mm * 60_000)

const studio = (
  over: Partial<Record<number, { open: string; close: string } | null>> = {},
  special: readonly string[] = [],
) => ({
  hours: weekly(over),
  utcOffsetMinutes: TR,
  specialWorkingDates: new Set(special as LocalDate[]),
})

const weekly = (over: Partial<Record<number, { open: string; close: string } | null>> = {}): WorkingHours =>
  ({
    0: null, // Sunday — closed
    1: { open: '10:00', close: '21:00' },
    2: { open: '10:00', close: '21:00' },
    3: { open: '10:00', close: '21:00' },
    4: { open: '10:00', close: '21:00' },
    5: { open: '10:00', close: '21:00' },
    6: { open: '11:00', close: '17:00' }, // Saturday — short
    ...over,
  }) as WorkingHours

describe('çalışma saatleri', () => {
  it('allows a class that sits inside the day’s window', () => {
    // Monday 19:00–20:00, studio open 10:00–21:00.
    expect(checkWorkingHours(studio(), at(0, 19), at(0, 20)).ok).toBe(true)
  })

  it('REFUSES a class that starts inside the window but ends after closing', () => {
    // 20:30–21:30 in a studio that closes at 21:00. The class must FIT, not merely begin: a lock-up
    // at 21:00 with a member still on a reformer is exactly what opening hours exist to prevent.
    const r = checkWorkingHours(studio(), at(0, 20, 30), at(0, 21, 30))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('outside_hours')
    expect(r.hours).toEqual({ open: '10:00', close: '21:00' })
  })

  it('refuses a class before opening', () => {
    const r = checkWorkingHours(studio(), at(0, 8), at(0, 9))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside_hours')
  })

  it('refuses any class on a day the studio does not open', () => {
    // Sunday (day 6 from Monday).
    const r = checkWorkingHours(studio(), at(6, 12), at(6, 13))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('closed_day')
  })

  it('reads EACH day on its own — Saturday closes at 17:00, not 21:00', () => {
    // A studio open 10–21 on weekdays and 11–17 on Saturday is the normal case, not the exception.
    const saturday = 5
    expect(checkWorkingHours(studio(), at(saturday, 16), at(saturday, 17)).ok).toBe(true)
    expect(checkWorkingHours(studio(), at(saturday, 17), at(saturday, 18)).ok).toBe(false)
    // …and the same hour on Friday is fine.
    expect(checkWorkingHours(studio(), at(4, 17), at(4, 18)).ok).toBe(true)
  })

  it('the boundaries are INSIDE: a class from exactly open to exactly close is allowed', () => {
    expect(checkWorkingHours(studio(), at(0, 10), at(0, 21)).ok).toBe(true)
  })

  it('no hours configured ⇒ no rule. A studio that has not told us when it is open has not asked us to police it', () => {
    expect(checkWorkingHours({ hours: null, utcOffsetMinutes: TR, specialWorkingDates: new Set<LocalDate>() }, at(6, 3), at(6, 4)).ok).toBe(true)
  })

  it('a malformed setting does not close the studio', () => {
    // A bad `HH:MM` is a bug in the settings screen. Refusing every class because of it would punish
    // reception for our mistake — the wrong end of the stick.
    const broken = studio({ 1: { open: 'abc', close: '21:00' } })
    expect(checkWorkingHours(broken, at(0, 19), at(0, 20)).ok).toBe(true)
  })

  // ── The calendar overrides the hours, and that is not a contradiction (D23) ──────────────
  //
  // `special_working_day` is the studio saying, in writing, "we are open on this date": a make-up
  // class on a Sunday, a workshop after closing. A blunt refusal would make those days unschedulable
  // and send reception back to paper. The calendar is the more specific statement, and the more
  // specific statement wins.
  it('a special working day opens a day the weekly hours call closed', () => {
    const sunday = 6 // 2024-01-07
    const refused = checkWorkingHours(studio(), at(sunday, 12), at(sunday, 13))
    expect(refused.ok).toBe(false)

    const declaredOpen = checkWorkingHours(studio({}, ['2024-01-07']), at(sunday, 12), at(sunday, 13))
    expect(declaredOpen.ok, 'the studio said it is open that day, and we refused anyway').toBe(true)
  })

  it('a special working day also waives the CLOSING time — a workshop may run late', () => {
    // Monday 21:30–23:00 in a studio that closes at 21:00, on a date the studio declared special.
    expect(checkWorkingHours(studio(), at(0, 21, 30), at(0, 23)).ok).toBe(false)
    expect(checkWorkingHours(studio({}, ['2024-01-01']), at(0, 21, 30), at(0, 23)).ok).toBe(true)
  })

  it('a special day on ANOTHER date changes nothing', () => {
    // The exception is a date, not a mood. Marking next Sunday special must not open this one.
    const sunday = 6
    expect(checkWorkingHours(studio({}, ['2024-01-14']), at(sunday, 12), at(sunday, 13)).ok).toBe(false)
  })

  it('the OFFSET decides the day — 23:30 UTC is already tomorrow in Istanbul', () => {
    // A class at Monday 23:30 local is Monday 20:30 UTC. Judging it in UTC would put it on the wrong
    // side of midnight, and this is the exact bug a stored offset would hide.
    const sundayLate = instant(MONDAY_MIDNIGHT - 30 * 60_000) // Sunday 23:30 local
    const r = checkWorkingHours(studio(), sundayLate, instant(Number(sundayLate) + 3_600_000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('closed_day') // Sunday, not Monday
  })
})
