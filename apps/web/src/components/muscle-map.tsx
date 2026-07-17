'use client'

import Model, { type IExerciseData, type Muscle as RBHMuscle } from 'react-body-highlighter'

// Re-export the highlighter's muscle union so the generated map (lib/exercise-muscles.ts) types against it.
export type Muscle = RBHMuscle

// The target-muscle body diagram (PF-11) — front + back figures with the worked muscles painted: the
// PRIMARY target bright red, the SECONDARY a lighter red, on a muted body. Matches the reference
// infographic. Pure SVG (react-body-highlighter, MIT) — no external asset, CSP-safe.
const COLORS = ['#f0a1a1', '#d62828'] // freq 1 = secondary (light red), freq 2 = primary (bright red)
const BODY = '#b7a8b0'

export function MuscleMap({ primary, secondary }: { primary: readonly Muscle[]; secondary: readonly Muscle[] }) {
  const data: IExerciseData[] = [
    ...(secondary.length ? [{ name: 'İkincil', muscles: [...secondary], frequency: 1 }] : []),
    ...(primary.length ? [{ name: 'Ana', muscles: [...primary], frequency: 2 }] : []),
  ]
  return (
    <div className="flex items-start justify-center gap-3">
      <Model data={data} type="anterior" highlightedColors={COLORS} bodyColor={BODY} style={{ width: '46%', maxWidth: 150 }} />
      <Model data={data} type="posterior" highlightedColors={COLORS} bodyColor={BODY} style={{ width: '46%', maxWidth: 150 }} />
    </div>
  )
}
