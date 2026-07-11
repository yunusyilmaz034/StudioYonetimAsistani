import {
  FirestoreCheckinRepository,
  FirestoreReservationRepository,
  instant,
  type BranchId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

export interface InsideMember {
  readonly memberId: string
  readonly checkedInAt: number
}
export interface ExpectedMember {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly sessionStartsAt: number
}
export interface CheckinState {
  readonly branchId: string | null
  readonly isOpen: boolean
  readonly occupancy: number
  readonly inside: readonly InsideMember[]
  readonly expectedSoon: readonly ExpectedMember[]
}

const SOON_MS = 15 * 60_000

// The check-in screen's read: the branch open state, who is currently inside, and the
// "expected but absent" list (D6) — reservations starting within 15 min whose member
// is not currently inside. Bounded reads; occupancy is NOT a projection (Phase 2).
export async function loadCheckinState(ctx: TenantContext, nowMs: number): Promise<CheckinState> {
  const branchId = (ctx.branchIds[0] ?? null) as BranchId | null
  if (!branchId) {
    return { branchId: null, isOpen: false, occupancy: 0, inside: [], expectedSoon: [] }
  }
  const db = adminDb()
  const checkinRepo = new FirestoreCheckinRepository(db)

  const [branch, inside, upcoming] = await Promise.all([
    checkinRepo.getBranch(ctx, branchId),
    checkinRepo.listPresence(ctx, branchId),
    new FirestoreReservationRepository(db).listBySessionStartRange(ctx, instant(nowMs), instant(nowMs + SOON_MS)),
  ])

  const insideIds = new Set(inside.map((p) => p.memberId))
  const expectedSoon = upcoming
    .filter((r) => r.status === 'booked' && !insideIds.has(r.memberId))
    .map((r) => ({
      reservationId: r.id,
      memberId: r.memberId,
      memberName: r.memberSnapshot.displayName,
      sessionStartsAt: r.sessionStartsAt,
    }))
    .sort((a, b) => a.sessionStartsAt - b.sessionStartsAt)

  return {
    branchId,
    isOpen: branch?.isOpen ?? false,
    occupancy: inside.length,
    inside: inside
      .map((p) => ({ memberId: p.memberId, checkedInAt: p.checkedInAt }))
      .sort((a, b) => b.checkedInAt - a.checkedInAt),
    expectedSoon,
  }
}
