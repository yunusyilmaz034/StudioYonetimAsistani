// Shared shapes for the AI programme designer — imported by BOTH the server (the AI call + action) and
// the client (the review UI). Kept free of `server-only` so the client review step can type its state.

export type ProgramLevel = 'beginner' | 'intermediate' | 'advanced'

export const PROGRAM_LEVELS: readonly { readonly id: ProgramLevel; readonly label: string }[] = [
  { id: 'beginner', label: 'Başlangıç' },
  { id: 'intermediate', label: 'Orta' },
  { id: 'advanced', label: 'İleri' },
]

export interface AiProgramExercise {
  readonly exerciseId: string
  readonly nameTr: string
  readonly sets: number
  readonly reps: string
  readonly restSeconds: number
  readonly note: string
}
export interface AiProgramDay {
  readonly name: string
  readonly exercises: readonly AiProgramExercise[]
}
export interface AiProgramResult {
  readonly title: string
  readonly days: readonly AiProgramDay[]
  // Whether the AI actually drafted it, or the deterministic pool builder did (AI key absent / call
  // failed). Shown to the trainer so an all-fallback proposal isn't mistaken for a tailored one.
  readonly source: 'ai' | 'fallback'
}

// Map a (possibly trainer-edited) AI programme into the `publishProgramVersionAction` payload shape.
// Snapshot fields (nameTr/videoUrl/description) are filled server-side at publish, so not sent here.
export function aiToPublishDays(days: readonly AiProgramDay[]) {
  return days
    .map((d, i) => ({
      order: i + 1,
      name: d.name.trim() || `Gün ${i + 1}`,
      exercises: d.exercises.map((e, j) => ({
        exerciseId: e.exerciseId,
        order: j + 1,
        sets: e.sets,
        reps: e.reps.trim() || '12',
        restSeconds: e.restSeconds,
        tempo: '',
        note: e.note.trim(),
        alternativeExerciseId: null as string | null,
      })),
    }))
    .filter((d) => d.exercises.length > 0)
}
