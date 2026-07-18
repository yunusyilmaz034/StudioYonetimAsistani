import { describe, expect, it } from 'vitest'

import type { Exercise } from '@studio/core'

import type { Muscle } from '@/components/muscle-map'
import { buildProgram, toPublishDays } from './program-builder'

const ex = (id: string, nameTr: string, active = true): Exercise =>
  ({
    id,
    studioId: 'std_1',
    nameTr,
    nameEn: nameTr,
    description: '',
    muscleGroup: '',
    equipment: '',
    photoUrl: null,
    gifUrl: null,
    videoUrl: null,
    tips: '',
    commonMistakes: '',
    alternativeExerciseIds: [],
    active,
    version: 1,
    updatedBy: 'usr_1',
    updatedAt: 0,
  }) as unknown as Exercise

const map: Record<string, { primary: Muscle[]; secondary: Muscle[] }> = {
  'Lat Çekiş': { primary: ['upper-back'], secondary: ['biceps'] },
  'Dümbel Row': { primary: ['upper-back'], secondary: ['trapezius'] },
  'Bench Press': { primary: ['chest'], secondary: ['triceps'] },
  'Plank': { primary: ['abs'], secondary: ['lower-back'] },
  'Hip Thrust': { primary: ['gluteal'], secondary: ['hamstring'] },
}

describe('buildProgram — deterministic, pool-locked', () => {
  const exercises = [
    ex('e1', 'Lat Çekiş'),
    ex('e2', 'Dümbel Row'),
    ex('e3', 'Bench Press'),
    ex('e4', 'Plank'),
    ex('e5', 'Hip Thrust'),
    ex('e6', 'Bilinmeyen Hareket'), // not in the map → never picked
  ]

  it('picks only exercises that hit the focus, never one outside the pool', () => {
    const p = buildProgram({ exercises, focus: 'sirt', muscleMap: map })
    // e1/e2 hit the back primarily; e4 (Plank) counts via its lower-back SECONDARY.
    expect(p.exercises.map((e) => e.exerciseId).sort()).toEqual(['e1', 'e2', 'e4'])
    // A back focus never pulls in a chest movement or an unmatched (no muscle data) one.
    expect(p.exercises.some((e) => e.exerciseId === 'e3' || e.exerciseId === 'e6')).toBe(false)
  })

  it('prefers exercises NOT already in the current programme (a new programme is actually new)', () => {
    const p = buildProgram({ exercises, focus: 'sirt', excludeExerciseIds: ['e1'], muscleMap: map })
    // e2 (fresh) ranks before e1 (in the old programme), though both match.
    expect(p.exercises[0]?.exerciseId).toBe('e2')
  })

  it('applies the focus prescription (sets/reps/rest)', () => {
    const p = buildProgram({ exercises, focus: 'karin', muscleMap: map })
    expect(p.exercises[0]).toMatchObject({ exerciseId: 'e4', sets: 3, reps: '15', restSeconds: 45 })
  })

  it('an inactive exercise is never picked', () => {
    const p = buildProgram({ exercises: [ex('e1', 'Lat Çekiş', false)], focus: 'sirt', muscleMap: map })
    expect(p.exercises).toHaveLength(0)
  })

  it('toPublishDays emits one ordered day in the publish payload shape', () => {
    const p = buildProgram({ exercises, focus: 'gogus', muscleMap: map })
    const days = toPublishDays(p)
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ order: 1 })
    expect(days[0]?.exercises[0]).toMatchObject({ exerciseId: 'e3', order: 1, tempo: '', alternativeExerciseId: null })
  })
})
