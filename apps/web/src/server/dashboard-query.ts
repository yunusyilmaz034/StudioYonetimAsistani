import {
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  type BranchId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'
import { listMembers } from './members-query'

// Direct bounded reads (D1) — no projection. Each read is windowed (today / next-N /
// active-only / top-N); names come from the member list loaded once (DEBT-001).
const OFFSET_MIN = 180
const DAY_MS = 86_400_000
const INACTIVE_DAYS = 14 // D3 — policy; default 14
const EXPIRING_DAYS = 14
const RECENT_LIMIT = 8
const TOP = 12

const studioDayStart = (nowMs: number): number => {
  const dateStr = new Date(nowMs + OFFSET_MIN * 60_000).toISOString().slice(0, 10)
  return Date.parse(`${dateStr}T00:00:00Z`) - OFFSET_MIN * 60_000
}
const studioMMDD = (ms: number): string => new Date(ms + OFFSET_MIN * 60_000).toISOString().slice(5, 10)
const studioYear = (ms: number): number => Number(new Date(ms + OFFSET_MIN * 60_000).toISOString().slice(0, 4))

export interface NamedRow {
  readonly memberId: string
  readonly name: string
}
export interface InsideRow extends NamedRow {
  readonly checkedInAt: number
}
export interface SessionRow {
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly startsAt: number
  readonly bookedCount: number
  readonly capacity: number
  readonly category: string
}
export interface ExpiringRow extends NamedRow {
  readonly productName: string
  readonly validUntil: number
}
export interface BalanceRow extends NamedRow {
  readonly balanceKurus: number
}
export interface BirthdayRow extends NamedRow {
  readonly age: number | null
}
export interface RecentRow extends NamedRow {
  readonly joinedAt: number
}
export interface ExpectedRow {
  readonly memberId: string
  readonly name: string
  readonly startsAt: number
}

export interface DashboardData {
  readonly isOpen: boolean
  readonly occupancy: number
  readonly inside: readonly InsideRow[]
  readonly todayCheckInCount: number
  readonly todayCheckIns: readonly InsideRow[]
  readonly expectedSoon: readonly ExpectedRow[]
  readonly todaySessions: readonly SessionRow[]
  readonly todayPt: readonly SessionRow[]
  readonly expiringSoon: readonly ExpiringRow[]
  readonly balances: readonly BalanceRow[]
  readonly inactive: readonly RecentRow[]
  readonly recentMembers: readonly RecentRow[]
  readonly birthdays: readonly BirthdayRow[]
}

export async function loadDashboard(ctx: TenantContext, nowMs: number): Promise<DashboardData> {
  const db = adminDb()
  const branchId = (ctx.branchIds[0] ?? null) as BranchId | null
  const dayStart = studioDayStart(nowMs)
  const dayEnd = dayStart + DAY_MS
  const now = instant(nowMs)

  const checkin = new FirestoreCheckinRepository(db)
  const sched = new FirestoreSchedulingRepository(db)
  const ents = new FirestoreEntitlementRepository(db)
  const res = new FirestoreReservationRepository(db)

  const [members, branch, inside, todayCheckIns, sessions, expiring, active, upcoming, recentBookings] =
    await Promise.all([
      listMembers(ctx),
      branchId ? checkin.getBranch(ctx, branchId) : Promise.resolve(null),
      branchId ? checkin.listPresence(ctx, branchId) : Promise.resolve([]),
      branchId ? checkin.listCheckInsForDay(ctx, branchId, instant(dayStart)) : Promise.resolve([]),
      sched.listSessionsForDay(ctx, instant(dayStart), instant(dayEnd)),
      ents.listExpiringBetween(ctx, now, instant(nowMs + EXPIRING_DAYS * DAY_MS)),
      ents.listActive(ctx),
      res.listBySessionStartRange(ctx, now, instant(nowMs + 15 * 60_000)),
      res.listBySessionStartRange(ctx, instant(nowMs - INACTIVE_DAYS * DAY_MS), now),
    ])

  const nameOf = new Map(members.map((m) => [m.id as string, m.fullName]))
  const name = (id: string) => nameOf.get(id) ?? id
  const activeMembers = members.filter((m) => m.status === 'active')

  const insideRows: InsideRow[] = inside
    .map((p) => ({ memberId: p.memberId as string, name: name(p.memberId), checkedInAt: p.checkedInAt }))
    .sort((a, b) => b.checkedInAt - a.checkedInAt)

  const checkedInIds = new Map<string, number>()
  for (const c of todayCheckIns) if (c.direction === 'in') checkedInIds.set(c.memberId, c.occurredAt)
  const todayCheckInRows: InsideRow[] = [...checkedInIds.entries()]
    .map(([id, at]) => ({ memberId: id, name: name(id), checkedInAt: at }))
    .sort((a, b) => b.checkedInAt - a.checkedInAt)

  const insideSet = new Set(inside.map((p) => p.memberId as string))
  const expectedSoon: ExpectedRow[] = upcoming
    .filter((r) => r.status === 'booked' && !insideSet.has(r.memberId as string))
    .map((r) => ({ memberId: r.memberId as string, name: r.memberSnapshot.displayName, startsAt: r.sessionStartsAt }))
    .sort((a, b) => a.startsAt - b.startsAt)

  const sessionRows: SessionRow[] = sessions
    .filter((s) => s.status !== 'cancelled')
    .map((s) => ({
      sessionId: s.id,
      serviceName: s.serviceName,
      trainerName: s.trainerName,
      startsAt: s.startsAt,
      bookedCount: s.bookedCount,
      capacity: s.capacity,
      category: s.category,
    }))
    .sort((a, b) => a.startsAt - b.startsAt)

  const expiringSoon: ExpiringRow[] = expiring
    .map((e) => ({
      memberId: e.memberId as string,
      name: name(e.memberId),
      productName: e.productSnapshot.name,
      validUntil: e.validUntil,
    }))
    .sort((a, b) => a.validUntil - b.validUntil)
    .slice(0, TOP)

  const balances: BalanceRow[] = active
    .filter((e) => e.priceAgreed.amount - e.paidTotal.amount > 0)
    .map((e) => ({ memberId: e.memberId as string, name: name(e.memberId), balanceKurus: e.priceAgreed.amount - e.paidTotal.amount }))
    .sort((a, b) => b.balanceKurus - a.balanceKurus)
    .slice(0, TOP)

  const bookedRecently = new Set(recentBookings.map((r) => r.memberId as string))
  const inactive: RecentRow[] = activeMembers
    .filter((m) => !bookedRecently.has(m.id as string))
    .map((m) => ({ memberId: m.id as string, name: m.fullName, joinedAt: m.joinedAt }))
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .slice(0, TOP)

  const recentMembers: RecentRow[] = [...members]
    .sort((a, b) => b.joinedAt - a.joinedAt)
    .slice(0, RECENT_LIMIT)
    .map((m) => ({ memberId: m.id as string, name: m.fullName, joinedAt: m.joinedAt }))

  const todayMMDD = studioMMDD(nowMs)
  const year = studioYear(nowMs)
  const birthdays: BirthdayRow[] = activeMembers
    .filter((m) => m.birthDate && m.birthDate.slice(5) === todayMMDD)
    .map((m) => ({
      memberId: m.id as string,
      name: m.fullName,
      age: m.birthDate ? year - Number(m.birthDate.slice(0, 4)) : null,
    }))

  return {
    isOpen: branch?.isOpen ?? false,
    occupancy: inside.length,
    inside: insideRows,
    todayCheckInCount: todayCheckInRows.length,
    todayCheckIns: todayCheckInRows.slice(0, TOP),
    expectedSoon,
    todaySessions: sessionRows,
    todayPt: sessionRows.filter((s) => s.category === 'private'),
    expiringSoon,
    balances,
    inactive,
    recentMembers,
    birthdays,
  }
}
