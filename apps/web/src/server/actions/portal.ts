'use server'

import type { DomainError } from '@studio/core'
import {
  bookReservation,
  cancelReservation,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  normalizePhone,
  selectEntitlement,
  systemClock,
  toMemberSnapshot,
  updateMember,
  type ClassSessionId,
  type Email,
  type PhoneE164,
  type ReservationId,
} from '@studio/core'
import { z } from 'zod'

import { requireMemberContext } from '../auth'
import { adminAuth, adminDb } from '../firebase-admin'

// The member portal's writes (v1.21, Batches 7–8).
//
// One rule governs every function here: **the memberId comes from the session cookie.** No
// action takes a memberId, so none can be handed a forged one. What the client sends is a
// session id or a reservation id — and each of those is checked against HER before anything
// happens.
//
// No new booking logic exists in this file. Booking and cancellation call the SAME core
// use-cases the owner UI calls; the deciders are principal-agnostic, so the only difference is
// the actor stamped on the event: `{ type: 'member' }` — her booking, attributed to her.

const resDeps = () => ({
  repo: new FirestoreReservationRepository(adminDb()),
  entitlements: new FirestoreEntitlementRepository(adminDb()),
  clock: systemClock,
})

// ── Book ──────────────────────────────────────────────────────────────────────────────────
export async function bookOwnReservationAction(input: unknown) {
  const p = z.object({ sessionId: z.string().min(1) }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  const db = adminDb()

  const session = await new FirestoreSchedulingRepository(db).getSession(ctx, p.sessionId as ClassSessionId)
  if (!session) return { ok: false as const, error: { code: 'session_not_bookable' as const } }

  // D11 — self-booking is a POLICY, stamped on the session (never an `if` in the portal). A
  // service that has not opted in refuses here, not in the UI.
  if (!session.policySnapshot.allowMemberSelfBooking) {
    return { ok: false as const, error: { code: 'member_self_booking_disabled' as const } }
  }

  const member = await new FirestoreMemberRepository(db).findById(ctx, memberId)
  if (!member) return { ok: false as const, error: { code: 'session_not_bookable' as const } }

  // Which package pays? The same selector reception's booking runs: earliest-expiring-first,
  // deterministic tie-break (I-17). It filters by the very walls the decider will re-check.
  const entitlements = await new FirestoreEntitlementRepository(db).listActiveByMember(ctx, memberId)
  const chosen = selectEntitlement(entitlements, session, systemClock.now())
  if (!chosen) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }

  // Every other rule — the category wall, the service wall (D12), PT ownership (D13), capacity,
  // credit, double-booking — is enforced by `decideBooking`, unchanged.
  return bookReservation(resDeps(), ctx, {
    memberId,
    memberSnapshot: toMemberSnapshot(member),
    sessionId: session.id,
    entitlementId: chosen.id,
  })
}

// ── Cancel ────────────────────────────────────────────────────────────────────────────────
export async function cancelOwnReservationAction(input: unknown) {
  const p = z.object({ reservationId: z.string().min(1) }).parse(input)
  const { ctx, memberId } = await requireMemberContext()

  const repo = new FirestoreReservationRepository(adminDb())
  const reservation = await repo.getReservation(ctx, p.reservationId as ReservationId)

  // The load-bearing check of this whole file: a reservation id is a client-supplied value, so
  // it is verified against the cookie's member BEFORE anything is cancelled. Otherwise a member
  // could cancel a stranger's class by guessing an id.
  if (!reservation || reservation.memberId !== memberId) {
    return { ok: false as const, error: { code: 'reservation_not_open' as const } }
  }

  // The credit effect (released vs. consumed on a late cancel) is the domain's call, judged
  // against the window STAMPED on the session (D14). Nothing here re-derives it.
  return cancelReservation(resDeps(), ctx, { reservationId: reservation.id })
}

// ── Profile (D9) ──────────────────────────────────────────────────────────────────────────
//
// The allow-list IS the rule: the action rebuilds the member from her stored record and
// overwrites exactly three fields. Anything else in the request body is ignored — a member
// cannot change her name, phone, birth date or status by sending them, because they are never
// read from the request.
export async function updateOwnProfileAction(
  input: unknown,
): Promise<{ ok: true; value: void } | { ok: false; error: DomainError }> {
  const p = z
    .object({
      email: z.string().email().nullable(),
      emergencyName: z.string().nullable(),
      emergencyPhone: z.string().nullable(),
    })
    .parse(input)

  const { ctx, memberId } = await requireMemberContext()
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)
  if (!member) return { ok: false as const, error: { code: 'invite_invalid' as const } }

  // The emergency contact's phone is held to the same standard as everyone else's: E.164 or
  // refused (AD-40). No "best effort" storage of an unusable number.
  let emergencyContact: { name: string; phone: PhoneE164 } | null = null
  if (p.emergencyName && p.emergencyPhone) {
    const normalized = normalizePhone(p.emergencyPhone)
    if (!normalized.ok) {
      return { ok: false as const, error: { code: 'invalid_phone', value: p.emergencyPhone } as const }
    }
    emergencyContact = { name: p.emergencyName, phone: normalized.value.e164 }
  }

  return updateMember({ repo: new FirestoreMemberRepository(adminDb()), clock: systemClock }, ctx, {
    memberId,
    // Immutable to her — taken from the RECORD, never from the request (D9).
    fullName: member.fullName,
    phone: member.phone,
    birthDate: member.birthDate,
    homeBranchId: member.homeBranchId,
    notes: member.notes,
    // Hers to change.
    email: (p.email ?? null) as Email | null,
    emergencyContact,
  })
}

// Password change. Re-authentication happens on the CLIENT (she must prove she knows the
// current one); this only writes the new password for the member the cookie names.
export async function changeOwnPasswordAction(input: unknown) {
  const p = z.object({ password: z.string() }).parse(input)
  if (p.password.length < 8) return { ok: false as const, error: { code: 'weak_password' as const } }

  const { memberId, ctx } = await requireMemberContext()
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)
  if (!member) return { ok: false as const, error: { code: 'invite_invalid' as const } }

  const { createHash } = await import('node:crypto')
  const uid = `mbr_${createHash('sha256').update(`${ctx.studioId}:${memberId}`).digest('hex').slice(0, 24)}`
  await adminAuth().updateUser(uid, { password: p.password })
  return { ok: true as const, value: undefined }
}
