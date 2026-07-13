import type { Firestore } from 'firebase-admin/firestore'

import {
  DEFAULT_STUDIO_CONFIG,
  localDateAt,
  offsetMinutesAt,
  type Instant,
  type LocalDate,
  type TenantContext,
} from '../../../shared'
import { FirestoreCalendarRepository } from '../../calendar'
import type { StudioHours } from '../domain/working-hours'
import { FirestoreSchedulingRepository } from './repos'

// AG-1 — the ONE place the studio's opening hours are resolved for a decision (v1.27, Alpha closure).
//
// Scheduling a class, booking a seat, moving one, a recurring series, every bulk act, and the member
// portal all take this port, and every one of them takes the SAME implementation. Two readers of
// "when are we open?" would be two answers, and the day they drift is the day a class can be booked
// into an hour it could not have been created in.
//
// ── It reads the CALENDAR too, and it must ──────────────────────────────────────────────────
// `special_working_day` is the studio saying, in writing, *"we are open on this date"* — a make-up
// class on a Sunday, a workshop after closing. Enforcing the weekly hours without consulting it would
// make those days unschedulable and send reception back to paper. The calendar is the more specific
// statement, and the more specific statement wins (D23).
//
// ── The window ──────────────────────────────────────────────────────────────────────────────
// The special days are loaded for a bounded window around today. It has to be bounded — the
// alternative is reading the whole calendar on every booking — and it is deliberately generous: a
// booking cannot be more than `maxDaysInAdvance` (≤ 14) ahead, and template generation is capped at
// 26 weeks. A date outside the window falls back to the plain weekly hours, so the failure mode is a
// REFUSAL a human sees, never a silent approval.
const WINDOW_BACK_DAYS = 1
const WINDOW_FORWARD_DAYS = 400
const DAY_MS = 86_400_000

// ── The offset is DERIVED, never stored ─────────────────────────────────────────────────────
// S2 stores the IANA zone (`Europe/Istanbul`) and derives the UTC offset at the instant in question.
// Türkiye has no DST, so today the answer is always +180 — but a stored `180` would be a silent lie
// the first time this product crosses a border, and it would be wrong for exactly one hour twice a
// year, which is the worst way for a bug to be wrong.
export class FirestoreStudioHours {
  private readonly scheduling: FirestoreSchedulingRepository
  private readonly calendar: FirestoreCalendarRepository

  constructor(db: Firestore) {
    this.scheduling = new FirestoreSchedulingRepository(db)
    this.calendar = new FirestoreCalendarRepository(db)
  }

  async getStudioHours(ctx: TenantContext, at?: Instant): Promise<StudioHours> {
    const now = at ?? (Date.now() as Instant)
    const settings = await this.scheduling.getStudioSettings(ctx)
    const timeZone = settings?.timeZone ?? DEFAULT_STUDIO_CONFIG.timeZone
    const utcOffsetMinutes = offsetMinutesAt(timeZone, now)

    const from = localDateAt((now - WINDOW_BACK_DAYS * DAY_MS) as Instant, utcOffsetMinutes)
    const to = localDateAt((now + WINDOW_FORWARD_DAYS * DAY_MS) as Instant, utcOffsetMinutes)
    const days = await this.calendar.listDays(ctx, from, to)

    const specialWorkingDates = new Set<LocalDate>()
    for (const d of days) {
      if (d.type !== 'special_working_day') continue
      // A calendar day is a RANGE (`dateFrom`–`dateTo`), so a three-day workshop weekend is one row.
      for (let day = d.dateFrom; day <= d.dateTo; day = nextDate(day)) specialWorkingDates.add(day)
    }

    return {
      // `null` means the studio has not told us when it is open — and a studio that has not told us
      // has not asked us to police it. It does NOT mean "closed".
      hours: settings?.workingHours ?? null,
      utcOffsetMinutes,
      specialWorkingDates,
    }
  }
}

/** `YYYY-MM-DD` + 1 day, without touching `Date` semantics we would then have to reason about. */
function nextDate(date: LocalDate): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(y, m - 1, d) + DAY_MS
  return localDateAt(ms as Instant, 0)
}
