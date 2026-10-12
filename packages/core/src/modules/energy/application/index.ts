import {
  addLocalDays,
  err,
  localDateAt,
  newCorrelationId,
  newOperationId,
  ok,
  type DomainError,
  type EventSource,
  type Result,
  type TenantContext,
} from '../../../shared'
import { ageOn, basalKcal, dayView } from '../domain/calc'
import {
  decideLogCardio,
  decideLogSteps,
  decideRemoveCardio,
  decideSetWorkoutMinutes,
  decideStartTracking,
  decideStopTracking,
  decideUpdateProfile,
  type CardioInput,
  type DecideContext,
  type ProfileInput,
} from '../domain/decide'
import type { EnergyDay, EnergyDayView, EnergyProfile } from '../domain/types'
import type { EnergyDeps } from './ports'

export type { EnergyDeps, EnergyRepository, TickedWorkout, WorkoutSource } from './ports'

// load → decide (pure) → transact. Every write here is the member's own declaration about her own
// day; the caller has already established that `memberId` is the signed-in member.

function dctx(deps: EnergyDeps, ctx: TenantContext, source: EventSource): DecideContext {
  const now = deps.clock.now()
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now,
    today: localDateAt(now, deps.utcOffsetMinutes) as string,
    correlationId: newCorrelationId(),
    source,
  }
}

export const energyToday = (deps: EnergyDeps): string => localDateAt(deps.clock.now(), deps.utcOffsetMinutes) as string

export async function startEnergyTracking(
  deps: EnergyDeps,
  ctx: TenantContext,
  input: ProfileInput & { readonly memberId: string; readonly consent: boolean },
  source: EventSource,
): Promise<Result<EnergyProfile, DomainError>> {
  const existing = await deps.repo.getProfile(ctx, input.memberId)
  const r = decideStartTracking(dctx(deps, ctx, source), existing, input)
  if (!r.ok) return r
  await deps.repo.saveProfile(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

export async function updateEnergyProfile(
  deps: EnergyDeps,
  ctx: TenantContext,
  memberId: string,
  input: Omit<ProfileInput, 'sex'>,
  source: EventSource,
): Promise<Result<EnergyProfile, DomainError>> {
  const profile = await deps.repo.getProfile(ctx, memberId)
  const r = decideUpdateProfile(dctx(deps, ctx, source), profile, input)
  if (!r.ok) return r
  if (r.value.events.length > 0) await deps.repo.saveProfile(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

/** She withdraws consent: the profile and every day are erased, and one event records that. */
export async function stopEnergyTracking(
  deps: EnergyDeps,
  ctx: TenantContext,
  memberId: string,
  source: EventSource,
): Promise<Result<{ readonly daysErased: number }, DomainError>> {
  const profile = await deps.repo.getProfile(ctx, memberId)
  const daysErased = profile ? await deps.repo.countDays(ctx, memberId) : 0
  const r = decideStopTracking(dctx(deps, ctx, source), profile, daysErased)
  if (!r.ok) return r
  await deps.repo.eraseMember(ctx, memberId, r.value.events)
  return ok({ daysErased })
}

export async function logEnergySteps(
  deps: EnergyDeps,
  ctx: TenantContext,
  input: { readonly memberId: string; readonly date: string; readonly steps: number },
  source: EventSource,
): Promise<Result<EnergyDay, DomainError>> {
  const [profile, day] = await Promise.all([deps.repo.getProfile(ctx, input.memberId), deps.repo.getDay(ctx, input.memberId, input.date)])
  const r = decideLogSteps(dctx(deps, ctx, source), profile, day, input)
  if (!r.ok) return r
  await deps.repo.saveDay(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

export async function logEnergyCardio(
  deps: EnergyDeps,
  ctx: TenantContext,
  input: Omit<CardioInput, 'entryId'> & { readonly memberId: string },
  source: EventSource,
): Promise<Result<EnergyDay, DomainError>> {
  const [profile, day] = await Promise.all([deps.repo.getProfile(ctx, input.memberId), deps.repo.getDay(ctx, input.memberId, input.date)])
  // The id is minted here, where randomness is allowed to live — the decision stays pure.
  const r = decideLogCardio(dctx(deps, ctx, source), profile, day, { ...input, entryId: `crd_${newOperationId().slice(4)}` })
  if (!r.ok) return r
  await deps.repo.saveDay(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

export async function removeEnergyCardio(
  deps: EnergyDeps,
  ctx: TenantContext,
  input: { readonly memberId: string; readonly date: string; readonly entryId: string },
  source: EventSource,
): Promise<Result<EnergyDay, DomainError>> {
  const day = await deps.repo.getDay(ctx, input.memberId, input.date)
  const r = decideRemoveCardio(dctx(deps, ctx, source), day, input.entryId)
  if (!r.ok) return r
  await deps.repo.saveDay(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

export async function setEnergyWorkoutMinutes(
  deps: EnergyDeps,
  ctx: TenantContext,
  input: { readonly memberId: string; readonly date: string; readonly workoutLogId: string; readonly minutes: number },
  source: EventSource,
): Promise<Result<EnergyDay, DomainError>> {
  const [profile, day, ticked] = await Promise.all([
    deps.repo.getProfile(ctx, input.memberId),
    deps.repo.getDay(ctx, input.memberId, input.date),
    deps.workouts.tickedBetween(ctx, input.memberId, input.date, input.date),
  ])
  // A duration for a workout she did not tick that day would be a number attached to nothing.
  if (!ticked.some((t) => t.workoutLogId === input.workoutLogId)) return err({ code: 'energy_entry_not_found' })
  const r = decideSetWorkoutMinutes(dctx(deps, ctx, source), profile, day, input)
  if (!r.ok) return r
  await deps.repo.saveDay(ctx, r.value.next, r.value.events)
  return ok(r.value.next)
}

// ── READS ───────────────────────────────────────────────────────────────────────────────────

/** Her days from `from` to `to` inclusive, newest first — one view per date, entered or not. */
export async function energyDays(
  deps: EnergyDeps,
  ctx: TenantContext,
  memberId: string,
  from: string,
  to: string,
): Promise<Result<{ readonly profile: EnergyProfile; readonly days: readonly EnergyDayView[] }, DomainError>> {
  const profile = await deps.repo.getProfile(ctx, memberId)
  if (!profile) return err({ code: 'energy_not_started' })
  const [stored, ticked] = await Promise.all([
    deps.repo.listDays(ctx, memberId, from, to),
    deps.workouts.tickedBetween(ctx, memberId, from, to),
  ])
  const byDate = new Map(stored.map((d) => [d.date, d]))
  // She did not exist in this feature before she started it: no resting figure for earlier days.
  const startedOn = localDateAt(profile.startedAt, deps.utcOffsetMinutes) as string
  const days: EnergyDayView[] = []
  for (let date = to; date >= from && date >= startedOn; date = addLocalDays(date, -1)) {
    days.push(
      dayView({
        date,
        day: byDate.get(date) ?? null,
        fallback: { weightKg: profile.weightKg, basalKcal: basalKcal({ ...profile, age: ageOn(profile.birthYear, date) }) },
        workouts: ticked.filter((t) => t.date === date),
      }),
    )
  }
  return ok({ profile, days })
}
