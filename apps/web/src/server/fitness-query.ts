import {
  busiestBuckets,
  computeVisitStats,
  DEFAULT_FITNESS_CONFIG,
  FirestoreCheckinRepository,
  FirestoreSchedulingRepository,
  instant,
  occupancyLevel,
  offsetMinutesAt,
  weekdayHourHistogram,
  type BranchId,
  type BusyBucket,
  type FitnessOccupancyConfig,
  type OccupancyLevel,
  type TenantContext,
  type VisitStats,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// ── FITNESS ATTENDANCE & OCCUPANCY — the READ layer (Plus Phase 8). ────────────────────────────
//
// The one to hold (roadmap Doc 32 §8): this is a report over the checkin module's EXISTING
// `member.checked_in` facts. It writes nothing, emits no event, and never touches a credit. Every
// function here only READS check-ins and feeds the pure `@studio/core` fitness functions. `direction
// === 'in'` is the visit signal; a checkout is not a visit.

const DAY_MS = 86_400_000
const USAGE_WINDOW_DAYS = 30
const MEMBER_WINDOW_DAYS = 180 // enough history to show a real weekly streak

// The studio's occupancy bands, or the honest default (capacity 0 ⇒ level is null, and the UI says
// "kapasite tanımlı değil").
async function fitnessConfig(ctx: TenantContext): Promise<{ config: FitnessOccupancyConfig; offsetMinutes: number }> {
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  return {
    config: settings?.fitness ?? DEFAULT_FITNESS_CONFIG,
    offsetMinutes: offsetMinutesAt(settings?.timeZone ?? 'Europe/Istanbul', instant(Date.now())),
  }
}

// Studio-local day/weekday/hour from a UTC instant, using the studio's derived offset. Weekday is
// 0=Mon..6=Sun (epoch day 0 = Thursday → 3). Hours/mods are guarded against negative offsets.
const localEpochDay = (ms: number, offsetMin: number) => Math.floor((ms + offsetMin * 60_000) / DAY_MS)
const localWeekday = (epochDay: number) => (((epochDay % 7) + 3) % 7 + 7) % 7
const localHour = (ms: number, offsetMin: number) => {
  const local = ms + offsetMin * 60_000
  return Math.floor(((((local % DAY_MS) + DAY_MS) % DAY_MS)) / 3_600_000)
}

const branchOf = (ctx: TenantContext): BranchId | null => (ctx.branchIds[0] ?? null) as BranchId | null

// ── Live occupancy — the anonymous band + (for staff) the count. ──────────────────────────────
export interface OccupancyNow {
  readonly occupancy: number
  readonly level: OccupancyLevel | null
  readonly capacity: number
}

export async function loadOccupancyNow(ctx: TenantContext): Promise<OccupancyNow> {
  const branchId = branchOf(ctx)
  const { config } = await fitnessConfig(ctx)
  if (!branchId) return { occupancy: 0, level: occupancyLevel(0, config), capacity: config.capacity }
  const occupancy = await new FirestoreCheckinRepository(adminDb()).countPresence(ctx, branchId)
  return { occupancy, level: occupancyLevel(occupancy, config), capacity: config.capacity }
}

// ── 30-day studio usage — visits, unique members, busiest times. ──────────────────────────────
export interface StudioUsage {
  readonly windowDays: number
  readonly totalVisits: number
  readonly uniqueMembers: number
  readonly busiest: readonly BusyBucket[]
  readonly histogram: readonly BusyBucket[]
  readonly visitsPerWeekday: readonly number[]
  readonly capacity: number
}

export async function loadStudioUsage(ctx: TenantContext, nowMs: number): Promise<StudioUsage> {
  const branchId = branchOf(ctx)
  const { config, offsetMinutes } = await fitnessConfig(ctx)
  const empty: StudioUsage = {
    windowDays: USAGE_WINDOW_DAYS,
    totalVisits: 0,
    uniqueMembers: 0,
    busiest: [],
    histogram: [],
    visitsPerWeekday: [0, 0, 0, 0, 0, 0, 0],
    capacity: config.capacity,
  }
  if (!branchId) return empty

  const since = instant(nowMs - USAGE_WINDOW_DAYS * DAY_MS)
  const checkIns = (await new FirestoreCheckinRepository(adminDb()).listCheckInsForDay(ctx, branchId, since)).filter(
    (c) => c.direction === 'in',
  )
  const samples = checkIns.map((c) => ({
    weekday: localWeekday(localEpochDay(c.occurredAt, offsetMinutes)),
    hour: localHour(c.occurredAt, offsetMinutes),
  }))
  const visitsPerWeekday = [0, 0, 0, 0, 0, 0, 0]
  for (const s of samples) visitsPerWeekday[s.weekday] = (visitsPerWeekday[s.weekday] ?? 0) + 1

  return {
    windowDays: USAGE_WINDOW_DAYS,
    totalVisits: checkIns.length,
    uniqueMembers: new Set(checkIns.map((c) => c.memberId)).size,
    busiest: busiestBuckets(samples, 8),
    histogram: weekdayHourHistogram(samples),
    visitsPerWeekday,
    capacity: config.capacity,
  }
}

// ── One member's consistency — computed on read from her check-in days. ───────────────────────
export interface MemberFitness {
  readonly stats: VisitStats
  readonly recent: readonly number[] // recent visit instants, newest first
}

export async function loadMemberFitness(ctx: TenantContext, memberId: string, nowMs: number): Promise<MemberFitness> {
  const { offsetMinutes } = await fitnessConfig(ctx)
  const since = instant(nowMs - MEMBER_WINDOW_DAYS * DAY_MS)
  const checkIns = (
    await new FirestoreCheckinRepository(adminDb()).listCheckInsByMember(ctx, memberId as never, since)
  ).filter((c) => c.direction === 'in')
  const days = checkIns.map((c) => localEpochDay(c.occurredAt, offsetMinutes))
  const nowDay = localEpochDay(nowMs, offsetMinutes)
  return {
    stats: computeVisitStats(days, nowDay),
    recent: checkIns.map((c) => c.occurredAt).slice(0, 12),
  }
}
