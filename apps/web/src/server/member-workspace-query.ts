import {
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  instant,
  moneyByEntitlement,
  systemClock,
  type Member,
  type MemberEventRecord,
  type MemberId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// The Member Workspace read (v1.18). Direct bounded parallel reads — no projection,
// no aggregate (D2). Composes five existing/added read-only core reads by memberId.
// The Packages and Payments sections load subscriptions client-side via the existing
// listMemberSubscriptionsAction (SubscriptionView already carries balance/collected),
// so entitlements are not read here.
//
// Bounds are config, not scattered literals (D3) — one place to change them. These are
// read/display limits, NOT credit-affecting policy (non-negotiable #4 does not apply).
export const MEMBER_WORKSPACE_LIMITS = {
  checkInHistoryDays: 90, // §3.4
  pastReservations: 50, // §3.3
  auditEvents: 100, // §3.6
} as const

const DAY_MS = 86_400_000

export interface MemberReservationRow {
  readonly reservationId: string
  readonly status: string
  readonly category: string
  readonly startsAt: number
  readonly endsAt: number
  readonly creditEffect: string
}

export interface MemberCheckInRow {
  readonly id: string
  readonly direction: 'in' | 'out'
  readonly method: string
  readonly occurredAt: number
}

export interface MemberWorkspaceData {
  readonly member: Member
  // The count of currently-active packages, computed LIVE from the entitlements (status === 'active') —
  // NOT from `member.stats.activeEntitlementCount`, which no reactor maintains (it is permanently 0).
  // Matches the "Aktif paketi olan" members-list filter so the header and the list never disagree.
  readonly activePackageCount: number
  // The member's outstanding balance in kuruş, read LIVE from the LEDGER (moneyByEntitlement) — the same
  // source the Paketler/Cari Hesap tabs use — NOT from `member.stats.balanceDue`, which is also an
  // unmaintained (permanently 0) field. A debt must never read as 0 in the header while the tab shows it.
  readonly balanceDueKurus: number
  readonly upcomingReservations: readonly MemberReservationRow[]
  readonly pastReservations: readonly MemberReservationRow[]
  readonly insideNow: boolean
  readonly lastCheckInAt: number | null
  readonly checkInHistory: readonly MemberCheckInRow[]
  readonly audit: readonly MemberEventRecord[]
}

export async function loadMemberWorkspace(
  ctx: TenantContext,
  memberId: string,
  nowMs: number,
): Promise<MemberWorkspaceData | null> {
  const db = adminDb()
  const id = memberId as MemberId
  const since = instant(nowMs - MEMBER_WORKSPACE_LIMITS.checkInHistoryDays * DAY_MS)

  const members = new FirestoreMemberRepository(db)
  const reservations = new FirestoreReservationRepository(db)
  const checkin = new FirestoreCheckinRepository(db)
  const entitlements = new FirestoreEntitlementRepository(db)

  const [member, memberReservations, presence, checkIns, audit, activeEntitlements, money] = await Promise.all([
    members.findById(ctx, id),
    reservations.listByMember(ctx, id),
    checkin.getPresence(ctx, id),
    checkin.listCheckInsByMember(ctx, id, since),
    members.listMemberEvents(ctx, id, MEMBER_WORKSPACE_LIMITS.auditEvents),
    entitlements.listActiveByMember(ctx, id),
    moneyByEntitlement({ repo: new FirestoreFinanceRepository(db), clock: systemClock }, ctx, id),
  ])

  if (!member) return null

  // Sum the outstanding across every package this member bought (the ledger's `due`), so the header
  // balance matches the Cari Hesap tab to the kuruş.
  let balanceDueKurus = 0
  for (const m of money.values()) balanceDueKurus += m.due.amount

  const toRow = (r: (typeof memberReservations)[number]): MemberReservationRow => ({
    reservationId: r.id,
    status: r.status,
    category: r.sessionCategory,
    startsAt: r.sessionStartsAt,
    endsAt: r.sessionEndsAt,
    creditEffect: r.creditEffect,
  })

  // listByMember is newest-session-first. Upcoming re-sorted ascending (soonest next);
  // past kept descending and capped.
  const upcoming = memberReservations
    .filter((r) => r.sessionStartsAt >= nowMs)
    .map(toRow)
    .sort((a, b) => a.startsAt - b.startsAt)
  const past = memberReservations
    .filter((r) => r.sessionStartsAt < nowMs)
    .slice(0, MEMBER_WORKSPACE_LIMITS.pastReservations)
    .map(toRow)

  const history: MemberCheckInRow[] = checkIns.map((c) => ({
    id: c.id,
    direction: c.direction,
    method: c.method,
    occurredAt: c.occurredAt,
  }))

  return {
    member,
    activePackageCount: activeEntitlements.length,
    balanceDueKurus,
    upcomingReservations: upcoming,
    pastReservations: past,
    insideNow: presence !== null,
    lastCheckInAt: presence?.checkedInAt ?? history[0]?.occurredAt ?? null,
    checkInHistory: history,
    audit,
  }
}
