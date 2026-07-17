import {
  available,
  DEFAULT_INSIGHT_CONFIG,
  FirestoreFinanceRepository,
  saleBalanceDue,
  emptyDaily,
  FirestoreCalendarRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreOperationsRepository,
  FirestoreProjectionRepository,
  FirestoreSchedulingRepository,
  FirestoreWaitlistRepository,
  instant,
  lastActivityAt,
  localDateAt,
  type Category,
  type DailyReadModel,
  type Entitlement,
  type LocalDate,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'
import { loadFeed, type ActivityEvent } from './activity-query'

// ── THE OWNER DASHBOARD'S READ LAYER (v1.23, D24 + D29). ────────────────────────────────────
//
// The owner's rule was "tek sorguda açılsın, N+1 istemiyorum", and the honest answer is not one
// document — it is **a fixed, small number of reads that does not grow with the studio**:
//
//   1 projection read (today's counters)  +  5 bounded state queries, all in PARALLEL.
//
// Half of what the dashboard shows is not an event count at all. A membership expires because it is
// Thursday; nothing happened, so no counter can know. Those questions are asked of the state that
// owns them — bounded, indexed, and never one query per row.
//
// **There is no N+1 here.** Every list below comes from ONE query; the member names are resolved
// from the single member list we already hold.

const DAY_MS = 86_400_000
const OFFSET_MIN = 180 // studio timezone (Europe/Istanbul, no DST) — every metric is studio-local
const DEFAULT_LOW_CREDIT_THRESHOLD = 2 // owner D-4; overridden by studio settings
// Phase 2 — the dormancy horizon. Same thresholds the advisor bands on, so the dashboard's "cooling /
// at-risk" buckets and the Öneriler list agree. A "steady" visit cadence is once every ~week.
const DORMANT_ATTENTION_DAYS = DEFAULT_INSIGHT_CONFIG.dormantAttentionDays
const DORMANT_URGENT_DAYS = DEFAULT_INSIGHT_CONFIG.dormantUrgentDays
const STEADY_DAYS = 7

// "Bugün" is the studio's calendar day, 00:00:00–23:59:59 (owner).
const studioDayStart = (nowMs: number): number =>
  Math.floor((nowMs + OFFSET_MIN * 60_000) / DAY_MS) * DAY_MS - OFFSET_MIN * 60_000

export interface MemberRef {
  readonly id: string
  readonly name: string
}

export interface ExpiringRow extends MemberRef {
  readonly entitlementId: string
  readonly productName: string
  readonly validUntil: number
  readonly daysLeft: number
}

export interface LowCreditRow extends MemberRef {
  readonly entitlementId: string
  readonly productName: string
  readonly remaining: number
  readonly validUntil: number
}

export interface WaitingRow extends MemberRef {
  readonly entryId: string
  readonly sessionId: string
  readonly joinedAt: number
}

export interface EmptySessionRow {
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly startsAt: number
  readonly capacity: number
  readonly hoursAway: number
}

export interface OccupancyRow {
  readonly booked: number
  readonly capacity: number
}

export interface UpcomingOperationRow {
  readonly id: string
  readonly title: string
  readonly dateFrom: string
  readonly dateTo: string
  readonly kind: 'calendar' | 'closure'
  readonly status: string | null
}

export interface PendingPaymentRow extends MemberRef {
  readonly saleId: string
  readonly soldAt: number
  readonly totalKurus: number
  readonly dueKurus: number
  readonly daysOpen: number
}

// Phase 2 — a member with an active package who has stopped coming (the behavioural churn signal).
export interface DormantRow extends MemberRef {
  readonly lastActivityAt: number // max(lastCheckIn, lastAttendance, joinedAt)
  readonly daysSinceActivity: number
}

// The activity-recency spread across ALL active-with-package members — the shape the "Üye Nabzı"
// graphic draws. Buckets: taze (<7g) · düzenli (7–20g) · soğuyor (21–34g) · riskli (≥35g) · kayıtsız
// (we have never recorded her engaging — check-in/attendance/booking). `unrecorded` is NOT churn: it
// says the studio is not logging visits, which is a different (and fixable) problem.
export interface ActivityDistribution {
  readonly fresh: number
  readonly steady: number
  readonly cooling: number
  readonly atRisk: number
  readonly unrecorded: number
  readonly total: number
}

export interface OpenDrawerRow {
  readonly id: string
  readonly name: string
  readonly expectedKurus: number
  readonly openedAt: number | null
}

export interface OwnerDashboard {
  readonly date: string
  readonly today: DailyReadModel
  // The staleness signal: if the projector is failing, a wrong number must be LOUD (Doc 24 §11).
  readonly projectionLagsBehind: boolean

  readonly activeMembers: number // owner D-2: active record AND a valid, active package
  readonly newMembers30d: number
  readonly balanceDueKurus: number // owner D-1: satış − tahsilat, for the day

  // owner D-3: summed booked / summed capacity — NEVER the average of per-session percentages
  readonly occupancy: OccupancyRow
  readonly occupancyByCategory: Readonly<Record<Category, OccupancyRow>>

  readonly expiringSoon: readonly ExpiringRow[]
  readonly lowCredit: readonly LowCreditRow[] // remaining ≤ threshold AND > 0
  readonly exhausted: readonly LowCreditRow[] // remaining === 0 — its own list (owner D-4)
  readonly lowCreditThreshold: number
  readonly waiting: readonly WaitingRow[]
  readonly emptySessions: readonly EmptySessionRow[] // the next 7 days; the UI filters 24h/48h/7d
  readonly upcomingOperations: readonly UpcomingOperationRow[]
  readonly recentMembers: readonly (MemberRef & { joinedAt: number })[]
  // v1.24 — money the studio is owed, and kasalar left open. Both are questions about NOW, so both
  // are bounded state queries; a counter cannot know that a drawer is still open.
  readonly pendingPayments: readonly PendingPaymentRow[]
  readonly openDrawers: readonly OpenDrawerRow[]
  // Phase 2 — the churn signal: who has an active package but stopped coming, and the recency spread.
  readonly dormant: readonly DormantRow[]
  readonly activityDistribution: ActivityDistribution
  readonly feed: readonly ActivityEvent[]
}

const EMPTY_OCC: OccupancyRow = { booked: 0, capacity: 0 }

export async function loadOwnerDashboard(
  ctx: TenantContext,
  nowMs: number,
): Promise<OwnerDashboard> {
  const db = adminDb()
  const date = localDateAt(instant(nowMs), OFFSET_MIN) as string
  const dayStart = studioDayStart(nowMs)
  const dayEnd = dayStart + DAY_MS

  const sched = new FirestoreSchedulingRepository(db)

  // ── one projection read + five bounded state queries + the feed, all at once ──
  const [
    daily,
    members,
    entitlements,
    sessions7d,
    waiting,
    settings,
    calendar,
    closures,
    openSales,
    drawers,
    feed,
  ] = await Promise.all([
      new FirestoreProjectionRepository(db).getDaily(ctx, date),
      new FirestoreMemberRepository(db).list(ctx),
      new FirestoreEntitlementRepository(db).listActive(ctx),
      // Today (for occupancy) AND the next 7 days (for the empty-class alarm) in ONE range read.
      sched.listSessionsForDay(ctx, instant(dayStart), instant(nowMs + 7 * DAY_MS)),
      new FirestoreWaitlistRepository(db).listWaiting(ctx),
      sched.getStudioSettings(ctx),
      new FirestoreCalendarRepository(db).listDays(
        ctx,
        date as LocalDate,
        (localDateAt(instant(nowMs + 30 * DAY_MS), OFFSET_MIN) as string) as LocalDate,
      ),
      new FirestoreOperationsRepository(db).listClosures(ctx),
      new FirestoreFinanceRepository(db).listOpenSales(ctx),
      new FirestoreFinanceRepository(db).listDrawers(ctx),
      loadFeed(ctx, {}),
    ])

  const today = daily ?? emptyDaily(date)
  const names = new Map(members.map((m) => [m.id as string, m.fullName]))
  const nameOf = (id: string): string => names.get(id) ?? 'Silinmiş üye'

  // ── D-2 — an active member is an active RECORD with a valid, active package. A member with no
  // package is a contact, not a customer, and counting her would flatter the number the owner uses
  // to decide whether the studio is growing.
  const withValidPackage = new Set<string>()
  for (const e of entitlements) {
    if (!isValidNow(e, nowMs)) continue
    withValidPackage.add(e.memberId as string)
  }
  const activeMembers = members.filter(
    (m) => m.status === 'active' && withValidPackage.has(m.id as string),
  ).length
  const newMembers30d = members.filter((m) => m.joinedAt >= nowMs - 30 * DAY_MS).length

  // ── D-3 — occupancy: sum the seats, THEN divide. Averaging per-session percentages lets one 1/1
  // PT slot outweigh a 3/20 group class, and the owner would be reading a number that says the
  // studio is full when the room is empty.
  const todaySessions = sessions7d.filter(
    (s) => s.startsAt >= dayStart && s.startsAt < dayEnd && s.status !== 'cancelled' && s.capacity > 0,
  )
  const occupancy = todaySessions.reduce<OccupancyRow>(
    (acc, s) => ({ booked: acc.booked + s.bookedCount, capacity: acc.capacity + s.capacity }),
    EMPTY_OCC,
  )
  const occupancyByCategory = todaySessions.reduce<Record<string, OccupancyRow>>((acc, s) => {
    const cur = acc[s.category] ?? EMPTY_OCC
    acc[s.category] = { booked: cur.booked + s.bookedCount, capacity: cur.capacity + s.capacity }
    return acc
  }, {})

  // ── D-4 — credit-based packages only. An unlimited or period membership has no credits to run
  // low, and putting it in this list would send reception chasing a member who owes nothing.
  const threshold = settings?.lowCreditThreshold ?? DEFAULT_LOW_CREDIT_THRESHOLD
  const creditRows = entitlements
    .filter((e) => e.credits !== null && isValidNow(e, nowMs))
    .map((e) => ({
      entitlementId: e.id as string,
      id: e.memberId as string,
      name: nameOf(e.memberId as string),
      productName: e.productSnapshot.name,
      remaining: available(e.credits!),
      validUntil: e.validUntil as number,
    }))
  const lowCredit = creditRows
    .filter((r) => r.remaining > 0 && r.remaining <= threshold)
    .sort((a, b) => a.remaining - b.remaining)
  const exhausted = creditRows.filter((r) => r.remaining === 0).sort((a, b) => a.validUntil - b.validUntil)

  // Expiring memberships — the churn signal the owner acts on.
  const expiringSoon: ExpiringRow[] = entitlements
    .filter((e) => e.status === 'active' && e.validUntil > nowMs && e.validUntil <= nowMs + 14 * DAY_MS)
    .map((e) => ({
      entitlementId: e.id as string,
      id: e.memberId as string,
      name: nameOf(e.memberId as string),
      productName: e.productSnapshot.name,
      validUntil: e.validUntil as number,
      daysLeft: Math.max(0, Math.ceil((e.validUntil - nowMs) / DAY_MS)),
    }))
    .sort((a, b) => a.validUntil - b.validUntil)

  // ── D-5 — an empty class TOMORROW is not news. An empty class at 18:00 today is a phone call
  // reception can still make. The query holds a week; the screen decides the alarm's horizon.
  const emptySessions: EmptySessionRow[] = sessions7d
    .filter((s) => s.status !== 'cancelled' && s.startsAt > nowMs && s.bookedCount === 0)
    .map((s) => ({
      sessionId: s.id as string,
      serviceName: s.serviceName,
      trainerName: s.trainerName,
      startsAt: s.startsAt as number,
      capacity: s.capacity,
      hoursAway: (s.startsAt - nowMs) / 3_600_000,
    }))
    .sort((a, b) => a.startsAt - b.startsAt)

  const upcomingOperations: UpcomingOperationRow[] = [
    ...calendar.map((d) => ({
      id: d.id,
      title: d.title,
      dateFrom: d.dateFrom as string,
      dateTo: d.dateTo as string,
      kind: 'calendar' as const,
      status: null,
    })),
    ...closures
      .filter((c) => c.status === 'planned' && (c.dateTo as string) >= date)
      .map((c) => ({
        id: c.id,
        title: c.reason,
        dateFrom: c.dateFrom as string,
        dateTo: c.dateTo as string,
        kind: 'closure' as const,
        status: c.status,
      })),
  ]
    .sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : 1))
    .slice(0, 8)

  const pendingPayments: PendingPaymentRow[] = openSales
    .filter((s) => saleBalanceDue(s) > 0)
    .map((s) => ({
      saleId: s.id,
      id: s.memberId as string,
      name: nameOf(s.memberId as string),
      soldAt: s.soldAt as number,
      totalKurus: s.total.amount,
      dueKurus: saleBalanceDue(s),
      daysOpen: Math.max(0, Math.floor((nowMs - s.soldAt) / DAY_MS)),
    }))
    .sort((a, b) => b.daysOpen - a.daysOpen)

  const openDrawers: OpenDrawerRow[] = drawers
    .filter((d) => d.status === 'open')
    .map((d) => ({
      id: d.id,
      name: d.name,
      expectedKurus: d.expected.amount,
      openedAt: d.openedAt as number | null,
    }))

  // ── Phase 2 — the DORMANCY signal. Over the members who are supposed to be here (active record +
  // valid active package), how long since each last came? `lastActivityAt` maxes her check-in /
  // attendance recency, floored at joinedAt (a new member is not dormant). Zero extra reads: the member
  // list and `withValidPackage` are already in hand. NOT a projection — it is "how the world is right
  // now", a bounded state computation (daily.ts's rule).
  const activeWithPackage = members.filter((m) => m.status === 'active' && withValidPackage.has(m.id as string))
  let fresh = 0
  let steady = 0
  let cooling = 0
  let atRisk = 0
  let unrecorded = 0
  const dormant: DormantRow[] = []
  for (const m of activeWithPackage) {
    const last = lastActivityAt(m.stats)
    // Never observed engaging → UNKNOWN, not dormant. She is not put on the call list; she is counted
    // so the owner can see how much of the studio has no activity recorded at all.
    if (last === null) {
      unrecorded++
      continue
    }
    const days = Math.floor((nowMs - last) / DAY_MS)
    if (days >= DORMANT_URGENT_DAYS) atRisk++
    else if (days >= DORMANT_ATTENTION_DAYS) cooling++
    else if (days >= STEADY_DAYS) steady++
    else fresh++
    if (days >= DORMANT_ATTENTION_DAYS) {
      dormant.push({ id: m.id as string, name: m.fullName, lastActivityAt: last, daysSinceActivity: days })
    }
  }
  dormant.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity)
  const activityDistribution: ActivityDistribution = { fresh, steady, cooling, atRisk, unrecorded, total: activeWithPackage.length }

  const newest = feed.entries[0]?.recordedAt ?? 0

  return {
    date,
    today,
    // If the newest event in the log is minutes ahead of the newest event the projection has
    // folded, the projector is behind (or dead). A wrong number must be loud.
    projectionLagsBehind: newest > 0 && newest - today.lastEventAt > 5 * 60_000,
    activeMembers,
    newMembers30d,
    balanceDueKurus: today.salesKurus - today.collectedKurus,
    occupancy,
    occupancyByCategory: occupancyByCategory as Readonly<Record<Category, OccupancyRow>>,
    expiringSoon,
    lowCredit,
    exhausted,
    lowCreditThreshold: threshold,
    waiting: waiting.map((w) => ({
      entryId: w.id,
      id: w.memberId as string,
      name: nameOf(w.memberId as string),
      sessionId: w.classSessionId as string,
      joinedAt: w.joinedAt as number,
    })),
    emptySessions,
    upcomingOperations,
    pendingPayments,
    openDrawers,
    dormant,
    activityDistribution,
    recentMembers: [...members]
      .sort((a, b) => b.joinedAt - a.joinedAt)
      .slice(0, 5)
      .map((m) => ({ id: m.id as string, name: m.fullName, joinedAt: m.joinedAt as number })),
    feed: feed.entries.slice(0, 15),
  }
}

// A package that counts: active, started, not yet expired, not frozen (owner D-2/D-4).
const isValidNow = (e: Entitlement, nowMs: number): boolean =>
  e.status === 'active' && e.validFrom <= nowMs && e.validUntil >= nowMs && e.freeze === null
