import { isDemoMode } from './demo-mode'
import { maskName } from '@/lib/demo-mask'
import { FirestoreMemberRepository, FirestoreReservationRepository, instant, type TenantContext } from '@studio/core'

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
  const [schedule, reservations, members] = await Promise.all([
    loadSchedule(ctx, dateStr),
    new FirestoreReservationRepository(adminDb()).listBySessionStartRange(ctx, instant(from), instant(to)),
    // The DESK's calendar shows full names. The reservation's own snapshot deliberately holds only
    // "given name + surname initial" (AD-44) — that bound protects the TRAINER's roster, where a
    // reduced identity is enough to tell two members apart. Reception is a different audience: she
    // already reads full names on the member list, so reading them here reveals nothing new, and
    // "İREM K." is genuinely ambiguous once two İrems book the same week.
    //
    // The snapshot itself is untouched: this is a display-time join, not a change to what a
    // reservation stores. One extra read of a small collection.
    new FirestoreMemberRepository(adminDb()).list(ctx),
  ])
  // Demo modu — takvim, üye adının en yoğun göründüğü ekran: bir ay boyunca kimin hangi gün ve saat
  // spora geldiği. Maskeleme burada sunucuda yapılır, ekranda değil.
  const demo = await isDemoMode()
  const fullNameById = new Map(
    members.map((m) => [m.id as string, demo ? maskName(m.fullName, m.id as string) : m.fullName]),
  )

  const rosters: Record<string, SessionRosterEntry[]> = {}
  for (const r of reservations) {
    if (r.status === 'cancelled' || r.status === 'late_cancelled') continue
    ;(rosters[r.classSessionId] ??= []).push({
      reservationId: r.id,
      memberId: r.memberId,
      // Falls back to the snapshot for a member who no longer exists (erased): her past reservation
      // still renders, with the reduced name the snapshot was built to preserve.
      memberName:
        fullNameById.get(r.memberId) ??
        (demo ? maskName(r.memberSnapshot.displayName, r.memberId) : r.memberSnapshot.displayName),
      status: r.status,
    })
  }
  for (const list of Object.values(rosters)) list.sort((a, b) => a.memberName.localeCompare(b.memberName, 'tr'))

  return { ...schedule, rosters }
}
