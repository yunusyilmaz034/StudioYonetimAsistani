'use server'

import {
  available,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
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
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const nonEmpty = z.string().min(1)

export interface RosterMember {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly phoneLast4: string
}

// The session's active roster (booked reservations only — a cancelled seat is freed).
export async function getSessionRosterAction(input: unknown): Promise<readonly RosterMember[]> {
  const p = z.object({ sessionId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const rows = await new FirestoreReservationRepository(adminDb()).listBySession(ctx, p.sessionId as ClassSessionId)
  return rows
    .filter((r) => r.status === 'booked')
    .map((r) => ({
      reservationId: r.id,
      memberId: r.memberId,
      memberName: r.memberSnapshot.displayName,
      phoneLast4: r.memberSnapshot.phoneLast4,
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
  if (session.bookedCount >= session.capacity) {
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
