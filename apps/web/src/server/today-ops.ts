import { FirestoreWaitlistRepository, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'
import { listAttendanceDay, studioToday } from './reservations-query'

// ── THE "BUGÜN" STRIP (Product Plus Phase 2 — Operations) ─────────────────────────────────────
//
// Reception's one-glance operational summary, on the staff home. It answers "what does today
// need?" — how much is on, what still has to be marked, who is waiting, which rooms have a note —
// and NOTHING it shows is invented: every number is read from state that already exists.
//
// Bounded reads (do NOT grow with the studio): today's sessions + rosters (2), the waiting list
// (1), the active room notes (1). It is deliberately separate from `loadOwnerDashboard` so the
// owner's analytics load is not made to carry attendance rosters it does not use.

export interface TodayOps {
  readonly sessionCount: number
  readonly booked: number
  readonly capacity: number
  /** Sessions that have ENDED but still carry an unmarked (booked) reservation. */
  readonly pendingAttendance: number
  readonly waiting: number
  readonly activeRoomNotes: number
}

export async function loadTodayOps(ctx: TenantContext, nowMs: number): Promise<TodayOps> {
  const date = studioToday()

  const [sessions, waitingEntries, notesSnap] = await Promise.all([
    listAttendanceDay(ctx, date),
    new FirestoreWaitlistRepository(adminDb()).listWaiting(ctx),
    adminDb().collection('studios').doc(ctx.studioId).collection('roomNotes').where('active', '==', true).get(),
  ])

  const live = sessions.filter((s) => s.status !== 'cancelled')
  const todayIds = new Set(live.map((s) => s.sessionId))

  let booked = 0
  let capacity = 0
  let pendingAttendance = 0
  for (const s of live) {
    booked += s.bookedCount
    capacity += s.capacity
    if (s.endsAt < nowMs && s.roster.some((e) => e.status === 'booked')) pendingAttendance += 1
  }

  const waiting = waitingEntries.filter((w) => todayIds.has(w.classSessionId as string)).length

  const activeRoomNotes = notesSnap.docs.filter((d) => {
    const end = d.get('endsAt')
    return typeof end !== 'number' || end >= nowMs
  }).length

  return { sessionCount: live.length, booked, capacity, pendingAttendance, waiting, activeRoomNotes }
}
