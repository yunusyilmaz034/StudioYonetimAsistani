import { FirestoreReservationRepository, instant, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'
import { loadSchedule, scheduleWindow, type ScheduleData } from './schedule-query'

// The Reservation Calendar (v1.19) reuses the Class Calendar's schedule read
// (sessions + rooms + staff + services) and joins the window's reservations onto each
// session — so a day cell can show the booked member NAMES (the old system's dense
// reservation calendar). No new core read: it is the same two reads the calendars
// already use, joined by classSessionId.

export interface SessionRosterEntry {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly status: string
}

export interface ReservationCalendarData extends ScheduleData {
  // sessionId → its booked/resolved members (cancelled seats excluded).
  readonly rosters: Record<string, readonly SessionRosterEntry[]>
}

export async function loadReservationCalendar(
  ctx: TenantContext,
  dateStr: string,
): Promise<ReservationCalendarData> {
  const [from, to] = scheduleWindow(dateStr)
  const [schedule, reservations] = await Promise.all([
    loadSchedule(ctx, dateStr),
    new FirestoreReservationRepository(adminDb()).listBySessionStartRange(ctx, instant(from), instant(to)),
  ])

  const rosters: Record<string, SessionRosterEntry[]> = {}
  for (const r of reservations) {
    if (r.status === 'cancelled' || r.status === 'late_cancelled') continue
    ;(rosters[r.classSessionId] ??= []).push({
      reservationId: r.id,
      memberId: r.memberId,
      memberName: r.memberSnapshot.displayName,
      status: r.status,
    })
  }
  for (const list of Object.values(rosters)) list.sort((a, b) => a.memberName.localeCompare(b.memberName, 'tr'))

  return { ...schedule, rosters }
}
