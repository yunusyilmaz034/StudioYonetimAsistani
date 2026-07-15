'use server'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  FirestoreWaitlistRepository,
  joinWaitlist,
  leaveWaitlist,
  promoteFromWaitlist,
  systemClock,
  toMemberSnapshot,
  type ClassSessionId,
  type MemberId,
  type PromoteDeps,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { reservationPolicyPort } from '../reservation-policy'

// D20 — the waiting list. Joining moves NO credit (I-29) and promotion is a deliberate act by
// staff, never automatic: an auto-promoted member who was never told would have her credit
// consumed by presumed attendance for a class she did not know she had.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const nonEmpty = z.string().min(1)

export interface WaitlistRow {
  readonly entryId: string
  readonly memberId: string
  readonly memberName: string
  readonly phoneLast4: string
  readonly status: string
  readonly joinedAt: number
  readonly position: number | null // 1-based among those still waiting
}

function deps(): PromoteDeps {
  const db = adminDb()
  return {
    repo: new FirestoreWaitlistRepository(db),
    clock: systemClock,
    scheduling: {
      repo: new FirestoreSchedulingRepository(db),
      clock: systemClock,
      studioConfig: DEFAULT_STUDIO_CONFIG,
      hours: new FirestoreStudioHours(adminDb()),
    },
    // AG-1 — a waitlist promotion IS a booking. It goes through `bookReservation` and it answers to
    // the studio's hours like any other seat.
    reservations: {
      repo: new FirestoreReservationRepository(db),
      clock: systemClock,
      hours: new FirestoreStudioHours(db),
      policy: reservationPolicyPort(),
    },
    loadEntitlements: (ctx, memberId) =>
      new FirestoreEntitlementRepository(db).listActiveByMember(ctx, memberId),
  }
}

export async function listWaitlistAction(input: unknown): Promise<readonly WaitlistRow[]> {
  const p = z.object({ sessionId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const entries = await new FirestoreWaitlistRepository(adminDb()).listBySession(
    ctx,
    p.sessionId as ClassSessionId,
  )
  let position = 0
  return entries.map((e) => ({
    entryId: e.id,
    memberId: e.memberId,
    memberName: e.memberSnapshot.displayName,
    phoneLast4: e.memberSnapshot.phoneLast4,
    status: e.status,
    joinedAt: e.joinedAt,
    position: e.status === 'waiting' ? ++position : null,
  }))
}

export async function joinWaitlistAction(input: unknown) {
  const p = z.object({ sessionId: nonEmpty, memberId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const db = adminDb()
  const member = await new FirestoreMemberRepository(db).findById(ctx, p.memberId as MemberId)
  if (!member) return { ok: false as const, error: { code: 'member_not_active' as const } }

  const resRepo = new FirestoreReservationRepository(db)
  return joinWaitlist(
    {
      ...deps(),
      hasBooking: async (sessionId, memberId) => {
        const roster = await resRepo.listBySession(ctx, sessionId)
        return roster.some((r) => r.memberId === memberId && r.status === 'booked')
      },
    },
    ctx,
    {
      sessionId: p.sessionId as ClassSessionId,
      memberId: p.memberId as MemberId,
      memberSnapshot: toMemberSnapshot(member),
    },
  )
}

export async function leaveWaitlistAction(input: unknown) {
  const p = z.object({ entryId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return leaveWaitlist(deps(), ctx, { entryId: p.entryId, reason: 'staff' })
}

// Promotion books the member — an ordinary reservation with an ordinary credit hold. If the seat
// is gone again, or her credits ran out, the booking refuses and she KEEPS her place in the queue.
export async function promoteWaitlistAction(input: unknown) {
  const p = z.object({ entryId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return promoteFromWaitlist(deps(), ctx, { entryId: p.entryId })
}
