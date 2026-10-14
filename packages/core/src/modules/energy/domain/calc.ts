import type { CardioMachine, EnergyDay, EnergyDayView, EnergySex, MealPortion, WorkoutLine } from './types'

// PURE arithmetic. No clock, no I/O. Every figure these produce is an ESTIMATE and the screens say
// so ("yaklaşık") — which is why the functions round to whole kilocalories and the display rounds
// further: a number shown to the last digit claims a precision none of this has.

const round = (n: number): number => Math.round(n)

/** Age in whole years on a given studio-local date, from a birth YEAR — the wizard asks no more. */
export function ageOn(birthYear: number, date: string): number {
  return Number(date.slice(0, 4)) - birthYear
}

/**
 * What the body spends at rest in a day.
 *
 * With a body-fat figure: Katch-McArdle, from lean mass — sex drops out, because the difference
 * between the sexes at rest IS mostly the difference in lean mass. Without one: Mifflin-St Jeor,
 * which is the best of the height/weight/age equations and needs the sex term.
 */
export function basalKcal(p: {
  readonly sex: EnergySex
  readonly weightKg: number
  readonly heightCm: number
  readonly age: number
  readonly bodyFatPercent: number | null
}): number {
  if (p.bodyFatPercent !== null) {
    const leanKg = p.weightKg * (1 - p.bodyFatPercent / 100)
    return round(370 + 21.6 * leanKg)
  }
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age
  return round(p.sex === 'female' ? base - 161 : base + 5)
}

// Walking costs about half a kilocalorie per kilogram per thousand steps ABOVE rest. One constant,
// deliberately: stride length and pace move it by a quarter either way, and a second decimal here
// would be decoration.
const KCAL_PER_STEP_PER_KG = 0.0005

export function stepsKcal(steps: number, weightKg: number): number {
  return round(steps * weightKg * KCAL_PER_STEP_PER_KG)
}

// ── ACTIVITY IS COUNTED NET ─────────────────────────────────────────────────────────────────
//
// A MET is "times resting". The day already counts the resting burn for all 24 hours, so an hour of
// training at 3.5 MET adds 2.5 — not 3.5 — or that hour is paid for twice. The same subtraction is
// applied to a cardio machine's own display, which shows the gross figure.
const RESISTANCE_MET = 3.5

/** Moderate steady effort on each machine. `other` is the cautious end. */
const CARDIO_MET: Readonly<Record<CardioMachine, number>> = {
  treadmill: 7,
  elliptical: 5,
  bike: 6.8,
  stairs: 8.8,
  rower: 7,
  other: 5,
}

const netOfRest = (met: number, weightKg: number, minutes: number): number =>
  Math.max(0, (met - 1) * weightKg * (minutes / 60))

export function workoutKcal(weightKg: number, minutes: number): number {
  return round(netOfRest(RESISTANCE_MET, weightKg, minutes))
}

/**
 * A cardio session. The machine's own figure wins when there is one — it knows the speed, the
 * incline and the resistance, and we know none of them — less the resting burn for those minutes.
 * Without a figure: the machine's MET, net.
 */
export function cardioKcal(p: {
  readonly machine: CardioMachine
  readonly minutes: number
  readonly weightKg: number
  readonly displayedKcal: number | null
}): number {
  if (p.displayedKcal !== null) return round(Math.max(0, p.displayedKcal - p.weightKg * (p.minutes / 60)))
  return round(netOfRest(CARDIO_MET[p.machine], p.weightKg, p.minutes))
}

/**
 * A session's length when the machine's screen showed calories but no time: the minutes at which
 * that machine, at her weight, would have shown that figure. Used ONLY to fill a missing duration
 * (which the net-of-rest subtraction needs) — never to second-guess a duration that was read.
 */
export function minutesFromDisplayedKcal(p: { readonly machine: CardioMachine; readonly weightKg: number; readonly displayedKcal: number }): number {
  const perMinute = (CARDIO_MET[p.machine] * p.weightKg) / 60
  return Math.max(1, Math.round(p.displayedKcal / perMinute))
}

/**
 * How long a programme day takes, from what the programme itself says: the work of each set, the
 * rest it prescribes, and a minute per exercise to walk over and set up. A DEFAULT — she can correct
 * it, and her correction wins (owner, 2026-10-13).
 */
export function estimateWorkoutMinutes(exercises: readonly { readonly sets: number; readonly restSeconds: number }[]): number {
  const WORK_SECONDS_PER_SET = 45
  const SETUP_SECONDS_PER_EXERCISE = 60
  const seconds = exercises.reduce((n, e) => n + e.sets * (WORK_SECONDS_PER_SET + e.restSeconds) + SETUP_SECONDS_PER_EXERCISE, 0)
  // To the nearest five: "47 dk" for a guess is the false precision this file exists to avoid.
  return Math.max(5, Math.round(seconds / 60 / 5) * 5)
}

/** One programme day she ticked, priced for the day's weight. */
export function workoutLine(p: {
  readonly workoutLogId: string
  readonly label: string
  readonly estimatedMinutes: number
  readonly correctedMinutes: number | undefined
  readonly weightKg: number
}): WorkoutLine {
  const minutes = p.correctedMinutes ?? p.estimatedMinutes
  return {
    workoutLogId: p.workoutLogId,
    label: p.label,
    minutes,
    estimated: p.correctedMinutes === undefined,
    kcal: workoutKcal(p.weightKg, minutes),
  }
}

// ── MEALS ────────────────────────────────────────────────────────────────────────────────────
//
// A portion is a coarse lever on purpose: "az / normal / çok" is a judgement she can make about her
// own plate; grams are not. The factors keep the normal estimate as the anchor.
const PORTION_FACTOR: Readonly<Record<MealPortion, number>> = { small: 0.6, normal: 1, large: 1.5 }

export function mealItemKcal(kcalNormal: number, portion: MealPortion): number {
  return Math.round(kcalNormal * PORTION_FACTOR[portion])
}

/**
 * The day as a screen shows it. `day` is `null` when she entered nothing — then the resting figure
 * comes from her profile as it stands, and any programme day she ticked is still counted, because
 * ticking it WAS an entry.
 */
export function dayView(p: {
  readonly date: string
  readonly day: EnergyDay | null
  readonly fallback: { readonly weightKg: number; readonly basalKcal: number }
  readonly workouts: readonly { readonly workoutLogId: string; readonly label: string; readonly estimatedMinutes: number }[]
}): EnergyDayView {
  const weightKg = p.day?.weightKg ?? p.fallback.weightKg
  const basal = p.day?.basalKcal ?? p.fallback.basalKcal
  const workouts = p.workouts.map((w) =>
    workoutLine({ ...w, correctedMinutes: p.day?.workoutMinutes[w.workoutLogId], weightKg }),
  )
  const steps = p.day?.steps ?? null
  const cardio = p.day?.cardio ?? []
  const sKcal = steps?.kcal ?? 0
  const wKcal = workouts.reduce((n, w) => n + w.kcal, 0)
  const cKcal = cardio.reduce((n, c) => n + c.kcal, 0)
  const active = sKcal + wKcal + cKcal
  const meals = p.day?.meals ?? []
  return {
    date: p.date,
    basalKcal: basal,
    steps,
    workouts,
    cardio,
    stepsKcal: sKcal,
    workoutKcal: wKcal,
    cardioKcal: cKcal,
    activeKcal: active,
    totalKcal: basal + active,
    meals,
    intakeKcal: meals.reduce((n, m) => n + m.kcal, 0),
  }
}

/**
 * Whether the evening summary goes out for this day (owner, 2026-10-13: *"aynen, gitmesin"*).
 * Only when she entered something: a notification that says "you rested today" is noise, and noise
 * is how a member learns to swipe the next one away unread.
 */
export const summaryIsDue = (view: Pick<EnergyDayView, 'activeKcal' | 'meals'>): boolean =>
  view.activeKcal > 0 || view.meals.length > 0

/** For display only: an estimate is shown to the nearest ten. */
export const roundForDisplay = (kcal: number): number => Math.round(kcal / 10) * 10
