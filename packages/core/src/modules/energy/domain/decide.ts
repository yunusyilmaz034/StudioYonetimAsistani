import {
  addLocalDays,
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  ENERGY_CARDIO_LOGGED,
  ENERGY_CARDIO_REMOVED,
  ENERGY_PROFILE_UPDATED,
  ENERGY_STEPS_LOGGED,
  ENERGY_TRACKING_STARTED,
  ENERGY_TRACKING_STOPPED,
  ENERGY_WORKOUT_MINUTES_SET,
} from '../events'
import { ageOn, basalKcal, cardioKcal, stepsKcal } from './calc'
import type { CardioEntry, CardioMachine, EnergyDay, EnergyGoal, EnergyProfile, EnergySex } from './types'

// PURE. (state, command, now, today) → next state + events. `today` is the studio-local date and it
// ARRIVES — nothing here reads a clock or knows a time zone.

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  /** Studio-local `YYYY-MM-DD` for `now`. */
  readonly today: string
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

type Outcome<T> = { readonly next: T; readonly events: NewEvent[] }

function base(ctx: DecideContext, kind: AggregateKind, id: string, memberId: string) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind, id },
    related: { memberId: memberId as MemberId },
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// ── THE RANGES — refused, never clamped ─────────────────────────────────────────────────────
//
// A typo ("640" for 64,0) silently clamped to the ceiling would produce a confident, wrong number
// every day afterwards. Outside these the wizard is told which field, and nothing is stored. They
// are deliberately wide: their job is to catch a slipped decimal, not to judge a body.
export const ENERGY_LIMITS = {
  weightKg: [30, 250],
  heightCm: [120, 220],
  age: [14, 95],
  bodyFatPercent: [5, 60],
  steps: [0, 100_000],
  minutes: [1, 300],
  displayedKcal: [1, 3000],
  distanceKm: [0, 100],
  /** How far back a day can still be filled in or corrected. */
  backfillDays: 7,
} as const

const within = (v: number, [lo, hi]: readonly [number, number]): boolean => Number.isFinite(v) && v >= lo && v <= hi

export interface ProfileInput {
  readonly sex: EnergySex
  readonly weightKg: number
  readonly heightCm: number
  readonly birthYear: number
  readonly bodyFatPercent: number | null
  readonly goal: EnergyGoal
}

function checkProfile(ctx: DecideContext, p: ProfileInput): DomainError | null {
  if (!within(p.weightKg, ENERGY_LIMITS.weightKg)) return { code: 'energy_profile_invalid', field: 'weightKg' }
  if (!within(p.heightCm, ENERGY_LIMITS.heightCm)) return { code: 'energy_profile_invalid', field: 'heightCm' }
  if (!Number.isInteger(p.birthYear) || !within(ageOn(p.birthYear, ctx.today), ENERGY_LIMITS.age))
    return { code: 'energy_profile_invalid', field: 'birthYear' }
  if (p.bodyFatPercent !== null && !within(p.bodyFatPercent, ENERGY_LIMITS.bodyFatPercent))
    return { code: 'energy_profile_invalid', field: 'bodyFatPercent' }
  return null
}

/** The wizard's last button. Consent is not a checkbox the UI may forget: without it, refused. */
export function decideStartTracking(
  ctx: DecideContext,
  existing: EnergyProfile | null,
  input: ProfileInput & { readonly memberId: string; readonly consent: boolean },
): Result<Outcome<EnergyProfile>, DomainError> {
  if (existing) return err({ code: 'energy_already_started' })
  if (!input.consent) return err({ code: 'energy_consent_required' })
  const bad = checkProfile(ctx, input)
  if (bad) return err(bad)
  const next: EnergyProfile = {
    studioId: ctx.studioId,
    memberId: input.memberId,
    sex: input.sex,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    birthYear: input.birthYear,
    bodyFatPercent: input.bodyFatPercent,
    goal: input.goal,
    consentedAt: ctx.now,
    startedAt: ctx.now,
    updatedAt: ctx.now,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'energy_profile', input.memberId, input.memberId),
        type: ENERGY_TRACKING_STARTED,
        payload: { hasBodyFat: input.bodyFatPercent !== null },
      },
    ],
  })
}

export function decideUpdateProfile(
  ctx: DecideContext,
  profile: EnergyProfile | null,
  input: Omit<ProfileInput, 'sex'>,
): Result<Outcome<EnergyProfile>, DomainError> {
  if (!profile) return err({ code: 'energy_not_started' })
  const merged: ProfileInput = { ...input, sex: profile.sex }
  const bad = checkProfile(ctx, merged)
  if (bad) return err(bad)
  const fields = (['weightKg', 'heightCm', 'birthYear', 'bodyFatPercent', 'goal'] as const).filter((f) => profile[f] !== input[f])
  const next: EnergyProfile = { ...profile, ...input, updatedAt: ctx.now }
  // Saving the form unchanged is not a change, and an event that says "nothing happened" is noise.
  if (fields.length === 0) return ok({ next: profile, events: [] })
  return ok({
    next,
    events: [{ ...base(ctx, 'energy_profile', profile.memberId, profile.memberId), type: ENERGY_PROFILE_UPDATED, payload: { fields } }],
  })
}

/** She withdraws. The caller erases the profile and every day; this is the fact that it happened. */
export function decideStopTracking(
  ctx: DecideContext,
  profile: EnergyProfile | null,
  daysErased: number,
): Result<{ readonly events: NewEvent[] }, DomainError> {
  if (!profile) return err({ code: 'energy_not_started' })
  return ok({
    events: [{ ...base(ctx, 'energy_profile', profile.memberId, profile.memberId), type: ENERGY_TRACKING_STOPPED, payload: { daysErased } }],
  })
}

// ── THE DAY ─────────────────────────────────────────────────────────────────────────────────

export const energyDayId = (memberId: string, date: string): string => `${memberId}_${date}`

/** Not tomorrow, and not further back than a week: an account filled in from memory is fiction. */
function dateAllowed(ctx: DecideContext, date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= ctx.today && date >= addLocalDays(ctx.today, -ENERGY_LIMITS.backfillDays)
}

/** The day she is writing to — the existing one, or a fresh one stamped with today's body. */
function openDay(ctx: DecideContext, profile: EnergyProfile, existing: EnergyDay | null, date: string): EnergyDay {
  if (existing) return existing
  return {
    id: energyDayId(profile.memberId, date),
    studioId: ctx.studioId,
    memberId: profile.memberId,
    date,
    weightKg: profile.weightKg,
    basalKcal: basalKcal({ ...profile, age: ageOn(profile.birthYear, date) }),
    steps: null,
    cardio: [],
    workoutMinutes: {},
    updatedAt: ctx.now,
  }
}

export function decideLogSteps(
  ctx: DecideContext,
  profile: EnergyProfile | null,
  existing: EnergyDay | null,
  input: { readonly date: string; readonly steps: number },
): Result<Outcome<EnergyDay>, DomainError> {
  if (!profile) return err({ code: 'energy_not_started' })
  if (!dateAllowed(ctx, input.date)) return err({ code: 'energy_date_out_of_range' })
  if (!Number.isInteger(input.steps) || !within(input.steps, ENERGY_LIMITS.steps)) return err({ code: 'energy_entry_invalid', field: 'steps' })
  const day = openDay(ctx, profile, existing, input.date)
  // The day's total, not an addition: she reads one number off her phone, and typing it twice must
  // not double her afternoon.
  const next: EnergyDay = {
    ...day,
    steps: { count: input.steps, kcal: stepsKcal(input.steps, day.weightKg), loggedAt: ctx.now },
    updatedAt: ctx.now,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'energy_day', day.id, profile.memberId),
        type: ENERGY_STEPS_LOGGED,
        payload: { date: input.date, replaced: day.steps !== null },
      },
    ],
  })
}

export interface CardioInput {
  readonly date: string
  readonly entryId: string
  readonly machine: CardioMachine
  readonly minutes: number
  readonly distanceKm: number | null
  readonly displayedKcal: number | null
  readonly source: 'photo' | 'manual'
}

export function decideLogCardio(
  ctx: DecideContext,
  profile: EnergyProfile | null,
  existing: EnergyDay | null,
  input: CardioInput,
): Result<Outcome<EnergyDay>, DomainError> {
  if (!profile) return err({ code: 'energy_not_started' })
  if (!dateAllowed(ctx, input.date)) return err({ code: 'energy_date_out_of_range' })
  if (!within(input.minutes, ENERGY_LIMITS.minutes)) return err({ code: 'energy_entry_invalid', field: 'minutes' })
  if (input.displayedKcal !== null && !within(input.displayedKcal, ENERGY_LIMITS.displayedKcal))
    return err({ code: 'energy_entry_invalid', field: 'kcal' })
  if (input.distanceKm !== null && !within(input.distanceKm, ENERGY_LIMITS.distanceKm))
    return err({ code: 'energy_entry_invalid', field: 'distanceKm' })
  const day = openDay(ctx, profile, existing, input.date)
  const entry: CardioEntry = {
    id: input.entryId,
    machine: input.machine,
    minutes: input.minutes,
    distanceKm: input.distanceKm,
    displayedKcal: input.displayedKcal,
    source: input.source,
    kcal: cardioKcal({ machine: input.machine, minutes: input.minutes, weightKg: day.weightKg, displayedKcal: input.displayedKcal }),
    loggedAt: ctx.now,
  }
  const next: EnergyDay = { ...day, cardio: [...day.cardio, entry], updatedAt: ctx.now }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'energy_day', day.id, profile.memberId),
        type: ENERGY_CARDIO_LOGGED,
        payload: {
          date: input.date,
          entryId: entry.id,
          machine: entry.machine,
          source: entry.source,
          hadDisplayedKcal: entry.displayedKcal !== null,
        },
      },
    ],
  })
}

export function decideRemoveCardio(
  ctx: DecideContext,
  day: EnergyDay | null,
  entryId: string,
): Result<Outcome<EnergyDay>, DomainError> {
  if (!day || !day.cardio.some((c) => c.id === entryId)) return err({ code: 'energy_entry_not_found' })
  if (!dateAllowed(ctx, day.date)) return err({ code: 'energy_date_out_of_range' })
  const next: EnergyDay = { ...day, cardio: day.cardio.filter((c) => c.id !== entryId), updatedAt: ctx.now }
  return ok({
    next,
    events: [{ ...base(ctx, 'energy_day', day.id, day.memberId), type: ENERGY_CARDIO_REMOVED, payload: { date: day.date, entryId } }],
  })
}

/** Her correction to how long a ticked programme day really took. */
export function decideSetWorkoutMinutes(
  ctx: DecideContext,
  profile: EnergyProfile | null,
  existing: EnergyDay | null,
  input: { readonly date: string; readonly workoutLogId: string; readonly minutes: number },
): Result<Outcome<EnergyDay>, DomainError> {
  if (!profile) return err({ code: 'energy_not_started' })
  if (!dateAllowed(ctx, input.date)) return err({ code: 'energy_date_out_of_range' })
  if (!within(input.minutes, ENERGY_LIMITS.minutes)) return err({ code: 'energy_entry_invalid', field: 'minutes' })
  const day = openDay(ctx, profile, existing, input.date)
  const next: EnergyDay = { ...day, workoutMinutes: { ...day.workoutMinutes, [input.workoutLogId]: input.minutes }, updatedAt: ctx.now }
  return ok({
    next,
    events: [
      {
        ...base(ctx, 'energy_day', day.id, profile.memberId),
        type: ENERGY_WORKOUT_MINUTES_SET,
        payload: { date: input.date, workoutLogId: input.workoutLogId },
      },
    ],
  })
}
