import type { CardioMachine } from './domain/types'

// Energy events. NO HEALTH DATA IN A PAYLOAD (#6) — and that is stricter here than it first looks.
//
// Weight, height and body fat are obviously out. But so are step counts, minutes and calories: the
// calorie figure is computed FROM the weight, so a payload carrying "6.200 steps, 200 kcal" hands the
// weight back to anyone who can divide. The events therefore record that something was declared,
// for which day, and of what kind — the behaviour — and the numbers stay on the member's documents,
// which are deleted when she stops (the events are not, and need not be).
//
// The producer is never in the type (#2): `energy_day.cardio_logged` is the same fact whether the
// figures were read off a photograph or typed. How they arrived is `source`, a field.

export const ENERGY_TRACKING_STARTED = 'energy_tracking.started'
export const ENERGY_PROFILE_UPDATED = 'energy_tracking.profile_updated'
export const ENERGY_TRACKING_STOPPED = 'energy_tracking.stopped'
export const ENERGY_STEPS_LOGGED = 'energy_day.steps_logged'
export const ENERGY_CARDIO_LOGGED = 'energy_day.cardio_logged'
export const ENERGY_CARDIO_REMOVED = 'energy_day.cardio_removed'
export const ENERGY_WORKOUT_MINUTES_SET = 'energy_day.workout_minutes_set'

/** `hasBodyFat`: whether the tighter (lean-mass) formula is in use — a fact about precision, not a value. */
export type EnergyTrackingStartedPayload = { readonly hasBodyFat: boolean }
/** WHICH fields changed, never what they changed to. */
export type EnergyProfileUpdatedPayload = { readonly fields: readonly string[] }
/** Stopping erases her profile and her days; this is the record that it happened. */
export type EnergyTrackingStoppedPayload = { readonly daysErased: number }
/** `replaced`: she corrected a count already entered for that day (a correction, not a second walk). */
export type EnergyStepsLoggedPayload = { readonly date: string; readonly replaced: boolean }
export type EnergyCardioLoggedPayload = {
  readonly date: string
  readonly entryId: string
  readonly machine: CardioMachine
  readonly source: 'photo' | 'manual'
  /** Whether the machine's own figure was used, or ours — how much of the cardio data is measured. */
  readonly hadDisplayedKcal: boolean
}
export type EnergyCardioRemovedPayload = { readonly date: string; readonly entryId: string }
export type EnergyWorkoutMinutesSetPayload = { readonly date: string; readonly workoutLogId: string }
