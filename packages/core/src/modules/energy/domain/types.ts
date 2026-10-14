import type { Instant, StudioId } from '../../../shared'

// ── ENERGY (owner, 2026-10-13) — "bugün kaç kalori yaktın?" ─────────────────────────────────
//
// The member's own daily account of what her body spent: what it spends lying still, plus what she
// declares she did — steps, a programme day, a session on a cardio machine. Everything here is a
// DECLARATION by the member (the same posture as the workout log, non-negotiable #11): none of it is
// attendance, occupancy or continuity, and none of it may ever be added to those.
//
// Weight, height and body fat are HEALTH data. They live on these member-scoped documents and never
// enter an event payload (#6) — not even indirectly: a step count next to the calories it produced
// gives the weight back with one division, so events carry neither.

export type EnergySex = 'female' | 'male'
export type EnergyGoal = 'lose' | 'maintain' | 'gain'
export const ENERGY_GOALS: readonly EnergyGoal[] = ['lose', 'maintain', 'gain']

/** What she told the wizard. One per member; stopping DELETES it (and her days) — see `stop`. */
export interface EnergyProfile {
  readonly studioId: StudioId
  readonly memberId: string
  // Stored per profile, never assumed in code: this studio is women-only and its wizard does not ask,
  // but the formula differs by sex and the platform has other customers. The caller supplies it.
  readonly sex: EnergySex
  readonly weightKg: number
  readonly heightCm: number
  readonly birthYear: number
  /** Optional. Present ⇒ the resting figure uses lean mass (Katch-McArdle), which is tighter. */
  readonly bodyFatPercent: number | null
  readonly goal: EnergyGoal
  /**
   * Meal logging on/off (owner, 2026-10-14 · 1.9.0). Off ⇒ nothing is added and "aldığın" is not
   * shown. Absent on profiles written before 1.9.0 ⇒ on.
   */
  readonly mealsEnabled: boolean
  /**
   * "Rakamları gizle": meals are still recorded, but no intake figure is shown to her — on screen or
   * in the evening notification. Counting calories unsettles some people; this lets her keep the
   * habit without the number. Absent ⇒ shown.
   */
  readonly hideIntake: boolean
  /** Explicit consent to process health data (KVKK). Without it nothing is stored. */
  readonly consentedAt: Instant
  readonly startedAt: Instant
  readonly updatedAt: Instant
}

export type CardioMachine = 'treadmill' | 'elliptical' | 'bike' | 'stairs' | 'rower' | 'other'
export const CARDIO_MACHINES: readonly CardioMachine[] = ['treadmill', 'elliptical', 'bike', 'stairs', 'rower', 'other']

export interface CardioEntry {
  readonly id: string
  readonly machine: CardioMachine
  readonly minutes: number
  readonly distanceKm: number | null
  /** What the machine's own screen said, when it said anything. `null` ⇒ we estimated from minutes. */
  readonly displayedKcal: number | null
  /**
   * `photo` ⇒ read off her picture of the machine's screen and added WITHOUT asking her to confirm
   * (owner, 2026-10-13: *"kullanıcıya sorma bir daha"*). The line shows what was read and she can
   * remove it — the correction is hers to make, the typing is not. `manual` ⇒ she typed it.
   */
  readonly source: 'photo' | 'manual'
  /** What this session ADDS to the day, already net of the resting burn the day counts anyway. */
  readonly kcal: number
  readonly loggedAt: Instant
}

// ── MEALS (owner, 2026-10-14 · 1.9.0) ─────────────────────────────────────────────────────────
//
// *"Öğün fotoğrafı çek, kalorisini hesaplayalım; kaç kalori aldığını da günlük kaydedelim."* What she
// ATE, as she confirmed it — unlike cardio, a meal is never saved unasked: reading a plate is far less
// reliable than reading a machine's screen, so the reading is a proposal and her tap is the record.

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
export type MealPortion = 'small' | 'normal' | 'large'
export const MEAL_PORTIONS: readonly MealPortion[] = ['small', 'normal', 'large']

export interface MealItem {
  /** As she sees it ("Izgara tavuk göğsü"). Hers, on her document — never in an event. */
  readonly name: string
  readonly portion: MealPortion
  /** The estimate for a NORMAL portion — kept so a later change of portion re-prices from the source. */
  readonly kcalNormal: number
  /** What this line adds, after the portion. */
  readonly kcal: number
}

export interface MealEntry {
  readonly id: string
  readonly slot: MealSlot
  readonly items: readonly MealItem[]
  /** `photo` ⇒ read from her plate and confirmed; `text` ⇒ estimated from what she wrote. */
  readonly source: 'photo' | 'text'
  readonly kcal: number
  readonly loggedAt: Instant
}

export interface StepsEntry {
  readonly count: number
  readonly kcal: number
  readonly loggedAt: Instant
}

/**
 * One member, one studio-local day. Created on her first entry of the day.
 *
 * `weightKg` and `basalKcal` are SNAPSHOTS taken when the day is first written: a later change to her
 * profile must not rewrite what an earlier day said. A day with no document is not an error — it is
 * a day she entered nothing, and it reads as the resting figure alone.
 */
export interface EnergyDay {
  readonly id: string // `${memberId}_${date}`
  readonly studioId: StudioId
  readonly memberId: string
  readonly date: string // studio-local YYYY-MM-DD
  readonly weightKg: number
  readonly basalKcal: number
  readonly steps: StepsEntry | null
  readonly cardio: readonly CardioEntry[]
  /**
   * Her correction to a programme day's duration, by workout-log id. The workout itself is NOT
   * copied here: the log stays the single record that she trained, so undoing it there removes it
   * from the day with nothing to keep in step.
   */
  readonly workoutMinutes: Readonly<Record<string, number>>
  /** What she ate (1.9.0). Absent on days written earlier ⇒ none. */
  readonly meals: readonly MealEntry[]
  readonly updatedAt: Instant
}

/** A programme day she ticked on this date — derived from the workout log at read time. */
export interface WorkoutLine {
  readonly workoutLogId: string
  readonly label: string
  readonly minutes: number
  /** `true` ⇒ `minutes` is our estimate from the programme; `false` ⇒ she corrected it. */
  readonly estimated: boolean
  readonly kcal: number
}

/** What a screen shows for one day. Pure: built by `dayView`, never stored. */
export interface EnergyDayView {
  readonly date: string
  readonly basalKcal: number
  readonly steps: StepsEntry | null
  readonly workouts: readonly WorkoutLine[]
  readonly cardio: readonly CardioEntry[]
  readonly stepsKcal: number
  readonly workoutKcal: number
  readonly cardioKcal: number
  /** Everything that is not the resting figure. `0` ⇒ she entered nothing — no evening summary. */
  readonly activeKcal: number
  readonly totalKcal: number
  readonly meals: readonly MealEntry[]
  /** What she ate, in kcal. `0` with no meals ⇒ she logged nothing — not "she ate nothing". */
  readonly intakeKcal: number
}
