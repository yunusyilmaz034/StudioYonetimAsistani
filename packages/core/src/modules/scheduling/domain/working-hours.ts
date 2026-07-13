import { localDateAt, type Instant, type LocalDate } from '../../../shared'
import type { DayHours, WorkingHours } from './types'

// AG-1 — ÇALIŞMA SAATLERİ, GERÇEKTEN UYGULANIR (v1.27, Alpha closure).
//
// Working hours have been stored since S2 and, until now, enforced nowhere: the form warned, the
// engine shrugged, and a class could be scheduled — and booked — at three in the morning. **A setting
// that does nothing is worse than a setting that is absent**, because the owner believes it.
//
// ── What the rule IS ────────────────────────────────────────────────────────────────────────
// A class must fit ENTIRELY inside the day's open–close window. Not start inside it: fit inside it.
// A 19:30 class in a studio that closes at 20:00 is a class whose second half nobody is there for,
// and a lock-up at 20:00 with a member still on a reformer is exactly the thing opening hours exist
// to prevent.
//
// ── The calendar OVERRIDES the hours, and that is not a contradiction ───────────────────────
// The studio calendar (D23) already has `special_working_day` — *"open when you would expect
// closed"* — and it exists precisely because a studio does hold the occasional class outside its own
// hours: a make-up class on a Sunday, a workshop after closing. A blunt refusal would make that day
// unschedulable and send reception back to paper.
//
// So the two rules compose, they do not fight:
//
//   working hours  → the studio's NORMAL week. "We open at 10 and close at 21, on a normal Tuesday."
//   the calendar   → this PARTICULAR date. "We are closed this Tuesday" / "we are open this Sunday."
//
// The calendar is the more specific statement, and the more specific statement wins. A
// `special_working_day` waives the hours entirely — the studio has said, in writing, that it is open.
// (A `studio_closed` day is refused elsewhere, by the calendar's own rules; this file never says a
// day is open that the calendar says is shut.)
//
// ── The clock ───────────────────────────────────────────────────────────────────────────────
// `HH:MM` is WALL CLOCK in the studio's timezone, and an `Instant` is not. The offset is passed in
// (derived from the stored IANA zone, S2) rather than assumed: this function is pure and it does not
// know what country it is in.

/**
 * Everything a decision needs in order to answer *"is the studio open then?"* — in one object, so it
 * cannot be half-passed.
 */
export interface StudioHours {
  /** `null` = the studio has not told us when it is open. That is not "closed": it is "no rule". */
  readonly hours: WorkingHours | null
  readonly utcOffsetMinutes: number
  /** The dates the calendar marks `special_working_day`. On these, the weekly hours do not apply. */
  readonly specialWorkingDates: ReadonlySet<LocalDate>
}

/** Minutes since local midnight, from an `HH:MM` string. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Local weekday (0 = Sunday) and minutes-since-local-midnight for an instant. */
function localParts(at: Instant, utcOffsetMinutes: number): { weekday: number; minutes: number } {
  const local = at + utcOffsetMinutes * 60_000
  const dayMs = 86_400_000
  const daysSinceEpoch = Math.floor(local / dayMs)
  // 1 Jan 1970 was a Thursday (4).
  const weekday = (((daysSinceEpoch + 4) % 7) + 7) % 7
  return { weekday, minutes: Math.floor((local - daysSinceEpoch * dayMs) / 60_000) }
}

export type WorkingHoursVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'closed_day' | 'outside_hours'
      readonly hours: DayHours | null
    }

/** May the studio hold a class from `startsAt` to `endsAt`? */
export function checkWorkingHours(
  studio: StudioHours,
  startsAt: Instant,
  endsAt: Instant,
): WorkingHoursVerdict {
  // A studio that has not told us when it is open has not asked us to police it. Inventing hours
  // ("09:00–18:00, probably") would refuse classes the studio actually holds.
  if (studio.hours === null) return { ok: true }

  // The calendar is the more specific statement, and it wins. The studio has declared this date open.
  const date = localDateAt(startsAt, studio.utcOffsetMinutes)
  if (studio.specialWorkingDates.has(date)) return { ok: true }

  const start = localParts(startsAt, studio.utcOffsetMinutes)
  const end = localParts(endsAt, studio.utcOffsetMinutes)

  const day = studio.hours[start.weekday as keyof WorkingHours] ?? null
  if (day === null) return { ok: false, reason: 'closed_day', hours: null }

  const open = minutesOf(day.open)
  const close = minutesOf(day.close)
  // Unreadable hours are not a licence to refuse everything: a malformed setting is a bug in the
  // settings screen, and punishing reception for it would be the wrong end of the stick.
  if (open === null || close === null || close <= open) return { ok: true }

  // A class that runs past midnight leaves the day it started in. No studio in this product does
  // that, and treating it as "inside the window" would be the one case that silently passes.
  const crossesMidnight = end.weekday !== start.weekday
  const fits = !crossesMidnight && start.minutes >= open && end.minutes <= close
  return fits ? { ok: true } : { ok: false, reason: 'outside_hours', hours: day }
}
