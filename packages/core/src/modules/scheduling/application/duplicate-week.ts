import { instant, type Result, type DomainError, type TenantContext } from '../../../shared'
import type { BranchId, RoomId, ServiceId, StaffUserId } from '../../../shared'
import type { ClassSession } from '../domain/types'
import type { SchedulingDeps } from './ports'
import { scheduleSession } from './session'

// "Bu haftayı tekrarla" — session-week DUPLICATION (v1.19). NOT recurring member
// reservations: it copies a week's concrete sessions (day/time/service/trainer/room/
// duration/capacity preserved) into the following N weeks. Application-layer over the
// existing scheduling primitives; the domain has no overlap rule, so conflict detection
// and "no silent overwrite" live here (owner decision C1, Doc 19 §11):
//   conflict = a session already exists at the SAME ROOM + start time (or, for a
//   room-less session, the SAME SERVICE + start time).
// Nothing is generated into the past.

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

export interface DuplicationTarget {
  readonly sourceSessionId: string
  readonly serviceId: ServiceId
  readonly serviceName: string
  readonly branchId: BranchId
  readonly branchName: string
  readonly roomId: RoomId | null
  readonly roomName: string | null
  readonly trainerId: StaffUserId | null
  readonly trainerName: string | null
  readonly date: string // 'YYYY-MM-DD' local
  readonly startTime: string // 'HH:MM' local
  readonly durationMinutes: number
  readonly capacity: number
  readonly startsAt: number // target instant (for display/sort)
  readonly weekOffset: number // 1..weeks
}

export interface DuplicationPlan {
  readonly toCreate: readonly DuplicationTarget[]
  readonly skippedPast: readonly DuplicationTarget[]
  readonly conflicts: readonly DuplicationTarget[]
}

const conflictKey = (roomId: RoomId | null, serviceId: ServiceId, startsAt: number): string =>
  roomId ? `r:${roomId}@${startsAt}` : `s:${serviceId}@${startsAt}`

// Pure: (source sessions, existing target-range sessions, weeks, now, offset) → plan.
// Istanbul has a fixed +3 offset (no DST), so a 7-day ms shift preserves local time.
export function computeDuplicationPlan(
  source: readonly ClassSession[],
  existingTargets: readonly ClassSession[],
  weeks: number,
  nowMs: number,
  utcOffsetMinutes: number,
): DuplicationPlan {
  const taken = new Set(
    existingTargets
      .filter((s) => s.status !== 'cancelled')
      .map((s) => conflictKey(s.roomId, s.serviceId, s.startsAt)),
  )
  const toCreate: DuplicationTarget[] = []
  const skippedPast: DuplicationTarget[] = []
  const conflicts: DuplicationTarget[] = []

  for (const s of source) {
    if (s.status !== 'scheduled') continue // only copy live, planned sessions
    // D13 — an assigned PT slot belongs to a member. Repeating the week must not silently
    // commit her to four more appointments, nor strip the assignment and leave phantom PT
    // inventory nobody asked for. Booking next week's PT is a decision, not a copy.
    if (s.assignedMemberId !== null) continue
    const durationMinutes = Math.round((s.endsAt - s.startsAt) / 60_000)
    for (let k = 1; k <= weeks; k++) {
      const startsAt = s.startsAt + k * WEEK_MS
      const localIso = new Date(startsAt + utcOffsetMinutes * 60_000).toISOString()
      const target: DuplicationTarget = {
        sourceSessionId: s.id,
        serviceId: s.serviceId,
        serviceName: s.serviceName,
        branchId: s.branchId,
        branchName: s.branchName,
        roomId: s.roomId,
        roomName: s.roomName,
        trainerId: s.trainerId,
        trainerName: s.trainerName,
        date: localIso.slice(0, 10),
        startTime: localIso.slice(11, 16),
        durationMinutes,
        capacity: s.capacity,
        startsAt,
        weekOffset: k,
      }
      if (startsAt <= nowMs) {
        skippedPast.push(target)
        continue
      }
      const key = conflictKey(s.roomId, s.serviceId, startsAt)
      if (taken.has(key)) {
        conflicts.push(target)
        continue
      }
      taken.add(key) // also prevents two source rows colliding into one target slot
      toCreate.push(target)
    }
  }
  return { toCreate, skippedPast, conflicts }
}

export interface DuplicateWeekInput {
  readonly weekStartDate: string // 'YYYY-MM-DD' — the Monday (local) of the source week
  readonly weeks: number // copy into this many following weeks (1..N)
}

function sourceWindow(weekStartDate: string, offsetMin: number): [number, number] {
  const from = Date.parse(`${weekStartDate}T00:00:00Z`) - offsetMin * 60_000
  return [from, from + WEEK_MS]
}

// Dry run — read the source week + the target range and compute the plan. No writes.
export async function planWeekDuplication(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: DuplicateWeekInput,
): Promise<DuplicationPlan> {
  const offset = deps.studioConfig.utcOffsetMinutes
  const [srcFrom, srcTo] = sourceWindow(input.weekStartDate, offset)
  const targetTo = srcFrom + (input.weeks + 1) * WEEK_MS
  const [source, existing] = await Promise.all([
    deps.repo.listSessionsForDay(ctx, instant(srcFrom), instant(srcTo)),
    deps.repo.listSessionsForDay(ctx, instant(srcTo), instant(targetTo)),
  ])
  return computeDuplicationPlan(source, existing, input.weeks, deps.clock.now(), offset)
}

// Apply — re-plan (a fresh conflict check at write time) then create each non-conflicting
// future session via the existing scheduleSession use-case. Returns what actually landed.
export async function applyWeekDuplication(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: DuplicateWeekInput,
): Promise<Result<{ created: number; plan: DuplicationPlan }, DomainError>> {
  const plan = await planWeekDuplication(deps, ctx, input)
  let created = 0
  for (const t of plan.toCreate) {
    const r = await scheduleSession(deps, ctx, {
      serviceId: t.serviceId,
      branchId: t.branchId,
      branchName: t.branchName,
      roomId: t.roomId,
      trainerId: t.trainerId,
      trainerName: t.trainerName,
      date: t.date,
      startTime: t.startTime,
      durationMinutes: t.durationMinutes,
      capacity: t.capacity,
    })
    if (r.ok) created++
    // a per-session domain refusal (e.g. a race) is skipped, never aborts the batch
  }
  return { ok: true, value: { created, plan } }
}
