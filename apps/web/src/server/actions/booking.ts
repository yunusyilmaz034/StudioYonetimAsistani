'use server'

import {
  occupiedSeats,
  available,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  selectEntitlement,
  systemClock,
  type ClassSessionId,
  type MemberId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Booking is owner + reception (member self-service is a later phase). These reads
// power the booking panel inside the session workspace; the write actions
// (bookReservationAction / cancelReservationAction) live in reservations.ts.
// DESK (owner, 2026-08-03) — trainers now cover reception in practice ("bizim hocalar biraz da
// resepsiyona bakıyor"), so the reservation agenda and check-in are theirs too. They are not full
// reception: the members list, the till, the funnel and the reports stay closed. Every write here
// already records WHO did it, which is what makes widening it safe rather than merely convenient.
const OPS = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const nonEmpty = z.string().min(1)

export interface RosterMember {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly phoneLast4: string
  readonly note: string | null // the staff quick note (Hızlı Not), if set
  // The reservation's outcome, so a PAST session's roster (attended / no-show) doesn't read like a
  // live booking. 'booked' for an upcoming, unresolved reservation.
  readonly status: 'booked' | 'attended' | 'no_show' | 'late_cancelled'
}

// The session's active roster (booked reservations only — a cancelled seat is freed).
export async function getSessionRosterAction(input: unknown): Promise<readonly RosterMember[]> {
  const p = z.object({ sessionId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const rows = await new FirestoreReservationRepository(adminDb()).listBySession(ctx, p.sessionId as ClassSessionId)

  // WHO IS ON THIS CLASS — and a member who cancelled is not, however late she did it.
  //
  // `late_cancelled` used to be listed here, on the reasoning that a late cancel does not free the
  // seat. It does: the session's own `bookedCount` stops counting her the moment she cancels. So the
  // list said five and the counter said three, and with two seats HELD for guests the panel appeared
  // to contradict itself twice over (owner, 2026-08-06: *"orada geç iptal diye Elif D.'yi görmeyelim,
  // kafa karışıyor"*).
  //
  // `attended` and `no_show` stay: after the class has run this is the record of who was expected,
  // and "came" and "did not come" are both answers to that. "Cancelled" is not — she withdrew.
  const OCCUPIES = new Set(['booked', 'attended', 'no_show'])
  return rows
    .filter((r) => OCCUPIES.has(r.status))
    .map((r) => ({
      reservationId: r.id,
      memberId: r.memberId,
      memberName: r.memberSnapshot.displayName,
      phoneLast4: r.memberSnapshot.phoneLast4,
      note: r.note?.text ?? null,
      status: r.status as RosterMember['status'],
    }))
    .sort((a, b) => a.memberName.localeCompare(b.memberName, 'tr'))
}

export interface AttendanceEntry {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly status: string // booked | attended | no_show | late_cancelled | cancelled
  readonly attendanceSource: string | null
}

// The session's attendance roster for the Session Workspace's Yoklama tab — every
// non-cancelled reservation with its current outcome. Marking is the offline command
// (markAttendanceCommand); this read shows what to mark / what was marked.
export async function getSessionAttendanceAction(input: unknown): Promise<readonly AttendanceEntry[]> {
  const p = z.object({ sessionId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const rows = await new FirestoreReservationRepository(adminDb()).listBySession(ctx, p.sessionId as ClassSessionId)
  return rows
    .filter((r) => r.status !== 'cancelled' && r.status !== 'late_cancelled')
    .map((r) => ({
      reservationId: r.id,
      memberId: r.memberId,
      memberName: r.memberSnapshot.displayName,
      status: r.status,
      attendanceSource: r.attendanceSource,
    }))
    .sort((a, b) => a.memberName.localeCompare(b.memberName, 'tr'))
}

export type BookingHint = 'ok' | 'full' | 'no_entitlement' | 'past'
export interface BookingStatus {
  readonly bookable: boolean
  readonly hint: BookingHint
  readonly entitlementId: string | null
  readonly productName: string | null
  readonly available: number | null // null ⇔ unlimited (period) entitlement
}

// Advisory credit availability for (member, session): runs the pure selectEntitlement
// (I-17). The booking transaction re-reads and re-validates — this only guides the UI
// (Doc 14: the pre-transaction selection is advisory).
export async function getBookingStatusAction(input: unknown): Promise<BookingStatus> {
  const p = z.object({ sessionId: nonEmpty, memberId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const db = adminDb()
  const now = systemClock.now()

  const session = await new FirestoreSchedulingRepository(db).getSession(ctx, p.sessionId as ClassSessionId)
  if (!session || session.status !== 'scheduled' || session.startsAt <= now) {
    return { bookable: false, hint: 'past', entitlementId: null, productName: null, available: null }
  }
  // Held seats are taken seats — see the mapper below.
  if (occupiedSeats(session) >= session.capacity) {
    return { bookable: false, hint: 'full', entitlementId: null, productName: null, available: null }
  }

  const candidates = await new FirestoreEntitlementRepository(db).listActiveByMember(ctx, p.memberId as MemberId)
  const chosen = selectEntitlement(candidates, session, now)
  if (!chosen) {
    return { bookable: false, hint: 'no_entitlement', entitlementId: null, productName: null, available: null }
  }
  return {
    bookable: true,
    hint: 'ok',
    entitlementId: chosen.id,
    productName: chosen.productSnapshot.name,
    available: chosen.credits ? available(chosen.credits) : null,
  }
}

export interface BookingMember {
  readonly id: string
  readonly fullName: string
  readonly phone: string
}

// The member picker's candidate list — active members only, searched client-side
// (DEBT-001). Loaded on demand when reception opens the picker.
export async function listBookingMembersAction(): Promise<readonly BookingMember[]> {
  const ctx = await requireTenantContext(OPS)
  const members = await new FirestoreMemberRepository(adminDb()).list(ctx)
  return members
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, fullName: m.fullName, phone: m.phone }))
}

export interface UpcomingSession {
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly startsAt: number
  readonly category: string
  readonly capacity: number
  readonly bookedCount: number
}

const UPCOMING_DAYS = 14
const DAY_MS = 86_400_000

// The quick-book session picker (Member Workspace, v1.18): future scheduled sessions
// in a forward window. Loaded on demand when reception opens quick-book — not part of
// the workspace's initial read. Reuses the scheduling range read; no new core read.
export async function listUpcomingSessionsAction(input: unknown): Promise<readonly UpcomingSession[]> {
  const p = z.object({ nowMs: z.number() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const sessions = await new FirestoreSchedulingRepository(adminDb()).listSessionsForDay(
    ctx,
    instant(p.nowMs),
    instant(p.nowMs + UPCOMING_DAYS * DAY_MS),
  )
  return sessions
    .filter((s) => s.status === 'scheduled' && s.startsAt > p.nowMs)
    .map((s) => ({
      sessionId: s.id,
      serviceName: s.serviceName,
      trainerName: s.trainerName,
      startsAt: s.startsAt,
      category: s.category,
      capacity: s.capacity,
      bookedCount: occupiedSeats(s),
    }))
    .sort((a, b) => a.startsAt - b.startsAt)
}
