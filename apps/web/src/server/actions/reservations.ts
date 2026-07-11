'use server'

import {
  bookReservation,
  cancelReservation,
  correctReservation,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  selectEntitlement,
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

  return bookReservation({ repo: new FirestoreReservationRepository(db), clock: systemClock }, ctx, {
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
    { repo: new FirestoreReservationRepository(adminDb()), clock: systemClock },
    ctx,
    { reservationId: p.reservationId as ReservationId },
  )
}

// Set the staff quick note (Hızlı Not) on a reservation. Staff-only metadata; empty text
// clears it. A note moves no credit, so it is a simple write. Owner + reception.
export async function setReservationNoteAction(input: unknown) {
  const p = z.object({ reservationId: nonEmpty, text: z.string() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return setReservationNote(
    { repo: new FirestoreReservationRepository(adminDb()), clock: systemClock },
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
    { repo: new FirestoreReservationRepository(adminDb()), clock: systemClock },
    ctx,
    { reservationId: p.reservationId as ReservationId, toOutcome: p.toOutcome, reason: p.reason },
  )
}
