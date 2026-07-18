import type { Exercise } from '@studio/core'

import type { Muscle } from '@/components/muscle-map'
import { EXERCISE_MUSCLES } from '@/lib/exercise-muscles'

// PF-35 — the SMART programme builder. Not an LLM: a deterministic, pure selection over OUR own
// 45-exercise pool (owner's decision). It cannot invent an exercise, cannot pick one outside the pool,
// costs nothing, runs instantly, and is exhaustively testable. The trainer ALWAYS reviews the result
// before it is committed — this only proposes.
//
// Muscle data lives in the web layer (`EXERCISE_MUSCLES`, keyed by nameTr), so the builder lives here.

export type ProgramFocus = 'karin' | 'kalca' | 'sirt' | 'gogus' | 'kol' | 'omuz' | 'bacak'

export const PROGRAM_FOCUSES: readonly { readonly id: ProgramFocus; readonly label: string }[] = [
  { id: 'karin', label: 'Karın' },
  { id: 'kalca', label: 'Kalça' },
  { id: 'sirt', label: 'Sırt' },
  { id: 'gogus', label: 'Göğüs' },
  { id: 'kol', label: 'Kol' },
  { id: 'omuz', label: 'Omuz' },
  { id: 'bacak', label: 'Bacak' },
]

// Focus → the muscles a matching exercise should hit (values from the body-highlighter map).
const FOCUS_MUSCLES: Record<ProgramFocus, readonly Muscle[]> = {
  karin: ['abs'],
  kalca: ['gluteal', 'abductors', 'adductor', 'hamstring'],
  sirt: ['upper-back', 'lower-back', 'trapezius'],
  gogus: ['chest'],
  kol: ['biceps', 'triceps', 'forearm'],
  omuz: ['front-deltoids', 'trapezius'],
  bacak: ['quadriceps', 'hamstring', 'calves', 'gluteal'],
}

// A sensible starting prescription per focus. The trainer adjusts anything on review.
const FOCUS_RX: Record<ProgramFocus, { readonly sets: number; readonly reps: string; readonly rest: number; readonly count: number }> = {
  karin: { sets: 3, reps: '15', rest: 45, count: 6 },
  kalca: { sets: 3, reps: '12-15', rest: 60, count: 6 },
  sirt: { sets: 3, reps: '10-12', rest: 60, count: 6 },
  gogus: { sets: 3, reps: '10-12', rest: 60, count: 6 },
  kol: { sets: 3, reps: '12-15', rest: 45, count: 5 },
  omuz: { sets: 3, reps: '12-15', rest: 45, count: 5 },
  bacak: { sets: 3, reps: '12', rest: 60, count: 6 },
}

export const focusLabel = (f: ProgramFocus): string => PROGRAM_FOCUSES.find((x) => x.id === f)?.label ?? f

export interface BuiltExercise {
  readonly exerciseId: string
  readonly nameTr: string
  readonly sets: number
  readonly reps: string
  readonly restSeconds: number
}
export interface BuiltProgram {
  readonly focus: ProgramFocus
  readonly title: string
  readonly dayName: string
  readonly exercises: readonly BuiltExercise[]
}

// Deterministic: same inputs → same programme. Prefers exercises NOT already in the member's current
// programme (so a "new" programme is actually new), then the ones that hit the focus hardest.
type MuscleMap = Record<string, { primary: readonly Muscle[]; secondary: readonly Muscle[] }>

export function buildProgram(input: {
  readonly exercises: readonly Exercise[]
  readonly focus: ProgramFocus
  readonly excludeExerciseIds?: readonly string[]
  // Defaults to the real generated map; injectable for tests.
  readonly muscleMap?: MuscleMap
}): BuiltProgram {
  const muscleMap = input.muscleMap ?? EXERCISE_MUSCLES
  const targets = new Set<string>(FOCUS_MUSCLES[input.focus])
  const exclude = new Set(input.excludeExerciseIds ?? [])
  const rx = FOCUS_RX[input.focus]

  const picked = input.exercises
    .filter((e) => e.active)
    .map((e) => {
      const m = muscleMap[e.nameTr]
      let score = 0
      if (m) {
        if (m.primary.some((x) => targets.has(x))) score += 3
        if (m.secondary.some((x) => targets.has(x))) score += 1
      }
      return { e, score, fresh: !exclude.has(e.id) }
    })
    .filter((x) => x.score > 0)
    // fresh (not in the old programme) first, then strongest match, then a stable name tie-break.
    .sort(
      (a, b) =>
        Number(b.fresh) - Number(a.fresh) || b.score - a.score || a.e.nameTr.localeCompare(b.e.nameTr, 'tr'),
    )
    .slice(0, rx.count)

  return {
    focus: input.focus,
    title: `${focusLabel(input.focus)} Programı`,
    dayName: `${focusLabel(input.focus)} — Gün 1`,
    exercises: picked.map((x) => ({
      exerciseId: x.e.id,
      nameTr: x.e.nameTr,
      sets: rx.sets,
      reps: rx.reps,
      restSeconds: rx.rest,
    })),
  }
}

// The publish payload (`publishProgramVersionAction` shape): one focus day. Snapshot fields
// (nameTr/videoUrl/description) are filled server-side at publish, so they are not sent here.
export function toPublishDays(built: BuiltProgram) {
  return [
    {
      order: 1,
      name: built.dayName,
      exercises: built.exercises.map((ex, i) => ({
        exerciseId: ex.exerciseId,
        order: i + 1,
        sets: ex.sets,
        reps: ex.reps,
        restSeconds: ex.restSeconds,
        tempo: '',
        note: '',
        alternativeExerciseId: null as string | null,
      })),
    },
  ]
}
