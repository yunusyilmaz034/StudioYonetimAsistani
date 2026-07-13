'use server'

import {
  applyRecurring,
  bookReservation,
  cancelReservation,
  correctReservation,
  FirestoreEntitlementRepository,
  moveReservation,
  previewRecurring,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  instant,
  selectEntitlement,
  type RecurringDeps,
  setReservationNote,
  systemClock,
  toMemberSnapshot,
  type ClassSessionId,
  type EntitlementId,
  type MemberId,
  type ReservationId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Booking and cancellation are synchronous, trusted writes (AD-35): they allocate a
// scarce seat and move a credit, so they run here — never on the /commands path.
// Authorized in the Server Action (AD-46): reception and the owner book and cancel.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const nonEmpty = z.string().min(1)

export async function bookReservationAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      sessionId: nonEmpty,
      entitlementId: nonEmpty.nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const db = adminDb()

  const member = await new FirestoreMemberRepository(db).findById(ctx, p.memberId as MemberId)
  if (!member) throw new Error(`Member not found: ${p.memberId}`)
  const memberSnapshot = toMemberSnapshot(member)

  // Reception may override; otherwise auto-select earliest-expiring-first (I-17).
  let entitlementId = (p.entitlementId ?? null) as EntitlementId | null
  if (!entitlementId) {
    const [candidates, session] = await Promise.all([
      new FirestoreEntitlementRepository(db).listActiveByMember(ctx, p.memberId as MemberId),
      new FirestoreSchedulingRepository(db).getSession(ctx, p.sessionId as ClassSessionId),
    ])
    if (!session) return { ok: false as const, error: { code: 'session_not_bookable' as const } }
    const chosen = selectEntitlement(candidates, session, systemClock.now())
    if (!chosen) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }
    entitlementId = chosen.id
  }

  return bookReservation({ repo: new FirestoreReservationRepository(db), clock: systemClock, hours: new FirestoreStudioHours(db) }, ctx, {
    sessionId: p.sessionId as ClassSessionId,
    entitlementId,
    memberId: p.memberId as MemberId,
    memberSnapshot,
  })
}

export async function cancelReservationAction(input: unknown) {
  const p = z.object({ reservationId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return cancelReservation(
    { repo: new FirestoreReservationRepository(adminDb()), clock: systemClock, hours: new FirestoreStudioHours(adminDb()) },
    ctx,
    { reservationId: p.reservationId as ReservationId },
  )
}

// D19 — the candidate classes a reservation may move to. Same category and service as the
// booking she already holds (a move is not a way around the walls), scheduled, in the future,
// with a free seat. The domain re-checks every one of these at write time; this list only
// spares reception a refusal she could have seen coming.
export interface MoveTarget {
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly roomName: string | null
  readonly startsAt: number
  readonly capacity: number
  readonly bookedCount: number
}

export async function listMoveTargetsAction(input: unknown): Promise<readonly MoveTarget[]> {
  const p = z.object({ reservationId: nonEmpty, nowMs: z.number() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const db = adminDb()
  const resRepo = new FirestoreReservationRepository(db)
  const reservation = await resRepo.getReservation(ctx, p.reservationId as ReservationId)
  if (!reservation) return []

  const sched = new FirestoreSchedulingRepository(db)
  const current = await sched.getSession(ctx, reservation.classSessionId)
  const sessions = await sched.listSessionsForDay(
    ctx,
    instant(p.nowMs),
    instant(p.nowMs + 28 * 86_400_000),
  )
  return sessions
    .filter(
      (s) =>
        s.id !== reservation.classSessionId &&
        s.status === 'scheduled' &&
        s.startsAt > p.nowMs &&
        s.category === reservation.sessionCategory &&
        (current ? s.serviceId === current.serviceId : true) &&
        s.bookedCount < s.capacity &&
        // An assigned PT slot belongs to someone; only its owner may be moved into it (I-9.9).
        (s.assignedMemberId == null || s.assignedMemberId === reservation.memberId),
    )
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, 40)
    .map((s) => ({
      sessionId: s.id,
      serviceName: s.serviceName,
      trainerName: s.trainerName,
      roomName: s.roomName,
      startsAt: s.startsAt,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
    }))
}

// D19 — move. One event, one hold. Reception may move a member past the free-move window, but
// only with a written reason (the domain refuses `reason_required` otherwise) — and that reason
// is stamped into the event, not into a comment field nobody reads.
export async function moveReservationAction(input: unknown) {
  const p = z
    .object({
      reservationId: nonEmpty,
      targetSessionId: nonEmpty,
      overrideReason: z.string().trim().min(1).nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  return moveReservation(
    { repo: new FirestoreReservationRepository(adminDb()), clock: systemClock, hours: new FirestoreStudioHours(adminDb()) },
    ctx,
    {
      reservationId: p.reservationId as ReservationId,
      targetSessionId: p.targetSessionId as ClassSessionId,
      overrideReason: p.overrideReason ?? null,
    },
  )
}

// ── D18 — SABİT REZERVASYON (recurring booking) ──────────────────────────────────────────────
// OP-5: preview writes nothing; apply re-derives. The generator NEVER creates a class — a week
// the studio never scheduled is reported as `no_session`, not conjured into existence.
function recurringDeps(): RecurringDeps {
  const db = adminDb()
  const sched = new FirestoreSchedulingRepository(db)
  const resRepo = new FirestoreReservationRepository(db)
  const entRepo = new FirestoreEntitlementRepository(db)
  const memRepo = new FirestoreMemberRepository(db)
  return {
    repo: resRepo,
    clock: systemClock,
    hours: new FirestoreStudioHours(db),
    utcOffsetMinutes: 180,
    loadWorld: async (ctx, memberId, sessionId, weeks) => {
      const seed = await sched.getSession(ctx, sessionId)
      const member = await memRepo.findById(ctx, memberId)
      if (!seed || !member) return null
      const [sessions, entitlements, memberReservations] = await Promise.all([
        sched.listSessionsForDay(
          ctx,
          instant(seed.startsAt),
          instant(seed.startsAt + (weeks + 1) * 7 * 86_400_000),
        ),
        entRepo.listActiveByMember(ctx, memberId),
        resRepo.listByMember(ctx, memberId),
      ])
      return { seed, sessions, entitlements, memberReservations, memberSnapshot: toMemberSnapshot(member) }
    },
  }
}

export async function previewRecurringAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      sessionId: nonEmpty,
      weeks: z.number().int().min(1).max(26),
      skipDates: z.array(z.string()).default([]),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  return previewRecurring(recurringDeps(), ctx, {
    memberId: p.memberId as MemberId,
    sessionId: p.sessionId as ClassSessionId,
    weeks: p.weeks,
    skipDates: p.skipDates,
  })
}

export async function applyRecurringAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      sessionId: nonEmpty,
      weeks: z.number().int().min(1).max(26),
      skipDates: z.array(z.string()).default([]),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  return applyRecurring(recurringDeps(), ctx, {
    memberId: p.memberId as MemberId,
    sessionId: p.sessionId as ClassSessionId,
    weeks: p.weeks,
    skipDates: p.skipDates,
  })
}

// Set the staff quick note (Hızlı Not) on a reservation. Staff-only metadata; empty text
// clears it. A note moves no credit, so it is a simple write. Owner + reception.
export async function setReservationNoteAction(input: unknown) {
  const p = z.object({ reservationId: nonEmpty, text: z.string() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return setReservationNote(
    { repo: new FirestoreReservationRepository(adminDb()), clock: systemClock, hours: new FirestoreStudioHours(adminDb()) },
    ctx,
    { reservationId: p.reservationId as ReservationId, text: p.text },
  )
}

// Correcting a resolved outcome moves a credit back, so it is a trusted Server Action
// (never a /commands write). Owner and reception may correct; the reason is mandatory
// and enforced in the domain (AD-22). The original resolution stays in the log — a
// correction is a compensating event, never a silent edit (non-negotiable #9).
export async function correctReservationAction(input: unknown) {
  const p = z
    .object({
      reservationId: nonEmpty,
      toOutcome: z.enum(['attended', 'no_show']),
      reason: nonEmpty,
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  return correctReservation(
    { repo: new FirestoreReservationRepository(adminDb()), clock: systemClock, hours: new FirestoreStudioHours(adminDb()) },
    ctx,
    { reservationId: p.reservationId as ReservationId, toOutcome: p.toOutcome, reason: p.reason },
  )
}
