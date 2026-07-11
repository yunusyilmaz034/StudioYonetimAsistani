import {
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  type ClassSession,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// Enriched reservation read (v1.17) — a join of two existing core reads, no new core
// read. Reservations carry the member snapshot + status + time; the session supplies
// trainer/service/occupancy/late-window. Bounded by the visible window.

export interface ReservationRow {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly phoneLast4: string
  readonly status: string
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerId: string | null
  readonly trainerName: string | null
  readonly category: string
  readonly startsAt: number
  readonly endsAt: number
  readonly capacity: number
  readonly bookedCount: number
  readonly cancellationWindowHours: number
  readonly lateCancellationConsumesCredit: boolean
}

export interface SessionOption {
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly startsAt: number
  readonly category: string
  readonly capacity: number
  readonly bookedCount: number
}

export interface ReservationsWindow {
  readonly reservations: readonly ReservationRow[]
  readonly sessions: readonly SessionOption[] // future scheduled sessions in the window, for booking
}

export async function loadReservationsWindow(
  ctx: TenantContext,
  fromMs: number,
  toMs: number,
  nowMs: number,
): Promise<ReservationsWindow> {
  const db = adminDb()
  const [reservations, sessions] = await Promise.all([
    new FirestoreReservationRepository(db).listBySessionStartRange(ctx, instant(fromMs), instant(toMs)),
    new FirestoreSchedulingRepository(db).listSessionsForDay(ctx, instant(fromMs), instant(toMs)),
  ])

  const byId = new Map<string, ClassSession>(sessions.map((s) => [s.id, s]))

  const rows: ReservationRow[] = reservations
    .map((r) => {
      const s = byId.get(r.classSessionId)
      return {
        reservationId: r.id,
        memberId: r.memberId,
        memberName: r.memberSnapshot.displayName,
        phoneLast4: r.memberSnapshot.phoneLast4,
        status: r.status,
        sessionId: r.classSessionId,
        serviceName: s?.serviceName ?? '—',
        trainerId: s?.trainerId ?? null,
        trainerName: s?.trainerName ?? null,
        category: s?.category ?? r.sessionCategory,
        startsAt: r.sessionStartsAt,
        endsAt: r.sessionEndsAt,
        capacity: s?.capacity ?? 0,
        bookedCount: s?.bookedCount ?? 0,
        cancellationWindowHours: s?.policySnapshot.cancellationWindowHours ?? 0,
        lateCancellationConsumesCredit: s?.policySnapshot.lateCancellationConsumesCredit ?? false,
      }
    })
    .sort((a, b) => a.startsAt - b.startsAt)

  const sessionOptions: SessionOption[] = sessions
    .filter((s) => s.status === 'scheduled' && s.startsAt > nowMs)
    .map((s) => ({
      sessionId: s.id,
      serviceName: s.serviceName,
      trainerName: s.trainerName,
      startsAt: s.startsAt,
      category: s.category,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
    }))
    .sort((a, b) => a.startsAt - b.startsAt)

  return { reservations: rows, sessions: sessionOptions }
}
