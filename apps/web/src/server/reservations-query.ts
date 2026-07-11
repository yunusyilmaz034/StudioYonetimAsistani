import {
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  type AttendanceSource,
  type ClassSessionStatus,
  type ReservationStatus,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// Server-only reads for the attendance workspace. Lives in server/ (the trusted
// boundary) so the page server component stays thin and never touches the Admin SDK
// directly — the same shape as members-query.ts.

// Studio timezone offset (AD-52: +180 for the Türkiye studio; a per-studio IANA
// timezone arrives later, seamless). Used only to compute local-day boundaries.
const STUDIO_UTC_OFFSET_MIN = 180

export interface RosterEntry {
  readonly reservationId: string
  readonly memberName: string
  readonly phoneLast4: string
  readonly status: ReservationStatus
  readonly attendanceSource: AttendanceSource | null
}

export interface SessionView {
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly roomName: string | null
  readonly startsAt: number
  readonly endsAt: number
  readonly capacity: number
  readonly bookedCount: number
  readonly status: ClassSessionStatus
  readonly category: string
  readonly roster: readonly RosterEntry[]
}

// The studio-local day [00:00, 24:00) for a 'YYYY-MM-DD' date, as a UTC-ms range.
export function studioDayRange(dateStr: string): [number, number] {
  const startUtc = Date.parse(`${dateStr}T00:00:00Z`) - STUDIO_UTC_OFFSET_MIN * 60_000
  return [startUtc, startUtc + 86_400_000]
}

// Today's date in the studio's timezone, 'YYYY-MM-DD'.
export function studioToday(): string {
  return new Date(Date.now() + STUDIO_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10)
}

// The attendance day: the studio's sessions for `dateStr`, each with its roster. Two
// reads — the day's sessions, and every reservation whose session starts that day
// (denormalised sessionStartsAt) — grouped by session. Cancelled reservations are
// excluded: a freed seat is not part of the roster.
export async function listAttendanceDay(
  ctx: TenantContext,
  dateStr: string,
): Promise<readonly SessionView[]> {
  const db = adminDb()
  const [fromMs, toMs] = studioDayRange(dateStr)
  const from = instant(fromMs)
  const to = instant(toMs)

  const [sessions, reservations] = await Promise.all([
    new FirestoreSchedulingRepository(db).listSessionsForDay(ctx, from, to),
    new FirestoreReservationRepository(db).listBySessionStartRange(ctx, from, to),
  ])

  const rosterBySession = new Map<string, RosterEntry[]>()
  for (const r of reservations) {
    if (r.status === 'cancelled' || r.status === 'late_cancelled') continue
    const list = rosterBySession.get(r.classSessionId) ?? []
    list.push({
      reservationId: r.id,
      memberName: r.memberSnapshot.displayName,
      phoneLast4: r.memberSnapshot.phoneLast4,
      status: r.status,
      attendanceSource: r.attendanceSource,
    })
    rosterBySession.set(r.classSessionId, list)
  }

  return sessions.map((s) => ({
    sessionId: s.id,
    serviceName: s.serviceName,
    trainerName: s.trainerName,
    roomName: s.roomName,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    capacity: s.capacity,
    bookedCount: s.bookedCount,
    status: s.status,
    category: s.category,
    roster: (rosterBySession.get(s.id) ?? []).sort((a, b) =>
      a.memberName.localeCompare(b.memberName, 'tr'),
    ),
  }))
}
