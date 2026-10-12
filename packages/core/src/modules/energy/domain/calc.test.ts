import { describe, expect, it } from 'vitest'

import { instant, type StudioId } from '../../../shared'
import { ageOn, basalKcal, cardioKcal, dayView, estimateWorkoutMinutes, minutesFromDisplayedKcal, roundForDisplay, stepsKcal, workoutKcal } from './calc'
import type { EnergyDay } from './types'

// The worked example on the owner's approved screens (2026-10-13): 64 kg, 165 cm, born 1992.
const HER = { sex: 'female' as const, weightKg: 64, heightCm: 165, age: 34, bodyFatPercent: null }

describe('the resting figure', () => {
  it('is Mifflin-St Jeor without a body-fat figure — 1.340 for the worked example', () => {
    expect(basalKcal(HER)).toBe(1340)
  })

  it('differs by sex by exactly the equation’s constant (166)', () => {
    expect(basalKcal({ ...HER, sex: 'male' }) - basalKcal(HER)).toBe(166)
  })

  it('uses lean mass when body fat is given — and then sex no longer matters', () => {
    // 64 kg at 27 % → 46,72 kg lean → 370 + 21,6 × 46,72 = 1.379
    expect(basalKcal({ ...HER, bodyFatPercent: 27 })).toBe(1379)
    expect(basalKcal({ ...HER, sex: 'male', bodyFatPercent: 27 })).toBe(1379)
  })

  it('takes age from the birth YEAR and the date it is asked about', () => {
    expect(ageOn(1992, '2026-10-13')).toBe(34)
    expect(ageOn(1992, '2027-01-01')).toBe(35)
  })
})

describe('what she did, counted NET of the rest the day already counts', () => {
  it('steps: half a kilocalorie per kilo per thousand', () => {
    expect(stepsKcal(6200, 64)).toBe(198)
    expect(stepsKcal(0, 64)).toBe(0)
  })

  it('a programme day adds 2.5 MET, not 3.5 — the resting hour is not paid for twice', () => {
    // 50 min at 64 kg: (3.5 − 1) × 64 × 50/60 = 133
    expect(workoutKcal(64, 50)).toBe(133)
  })

  it('a machine’s own figure wins, less the resting burn for those minutes', () => {
    // 180 on the screen, 22 minutes at 64 kg: 180 − 64 × 22/60 = 157
    expect(cardioKcal({ machine: 'treadmill', minutes: 22, weightKg: 64, displayedKcal: 180 })).toBe(157)
  })

  it('never goes negative when the screen shows less than rest would have burned', () => {
    expect(cardioKcal({ machine: 'bike', minutes: 60, weightKg: 64, displayedKcal: 20 })).toBe(0)
  })

  it('without a figure, the machine’s MET stands in', () => {
    // treadmill 7 MET net 6: 6 × 64 × 22/60 = 141
    expect(cardioKcal({ machine: 'treadmill', minutes: 22, weightKg: 64, displayedKcal: null })).toBe(141)
    expect(cardioKcal({ machine: 'stairs', minutes: 22, weightKg: 64, displayedKcal: null })).toBeGreaterThan(141)
  })
})

describe('how long a programme day takes — a default she can correct', () => {
  const ex = (sets: number, restSeconds: number) => ({ sets, restSeconds })

  it('adds up work, prescribed rest and a minute of set-up per exercise, to the nearest five', () => {
    // 7 exercises × (3 × (45 + 60) + 60) s = 2.625 s = 43,75 min → 45
    expect(estimateWorkoutMinutes(Array.from({ length: 7 }, () => ex(3, 60)))).toBe(45)
  })

  it('has a floor: a log whose programme can no longer be read still took some time', () => {
    expect(estimateWorkoutMinutes([])).toBe(5)
  })
})

describe('the day as a screen shows it', () => {
  const day: EnergyDay = {
    id: 'mem_1_2026-10-13',
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1',
    date: '2026-10-13',
    weightKg: 64,
    basalKcal: 1340,
    steps: { count: 6200, kcal: 198, loggedAt: instant(1) },
    cardio: [{ id: 'crd_1', machine: 'treadmill', minutes: 22, distanceKm: 2.4, displayedKcal: 180, source: 'photo', kcal: 157, loggedAt: instant(2) }],
    workoutMinutes: {},
    updatedAt: instant(2),
  }
  const ticked = [{ workoutLogId: 'wkl_1', label: 'Alt Vücut · Gün 2', estimatedMinutes: 50 }]
  const fallback = { weightKg: 70, basalKcal: 1400 }

  it('adds the four lines and keeps the resting figure apart from what she DID', () => {
    const v = dayView({ date: day.date, day, fallback, workouts: ticked })
    expect(v).toMatchObject({ basalKcal: 1340, stepsKcal: 198, workoutKcal: 133, cardioKcal: 157, activeKcal: 488, totalKcal: 1828 })
    expect(v.workouts[0]).toMatchObject({ minutes: 50, estimated: true })
  })

  it('her correction to the duration wins over the estimate', () => {
    const v = dayView({ date: day.date, day: { ...day, workoutMinutes: { wkl_1: 70 } }, fallback, workouts: ticked })
    expect(v.workouts[0]).toMatchObject({ minutes: 70, estimated: false, kcal: workoutKcal(64, 70) })
  })

  it('prices a day by the weight stamped ON that day, not her profile’s today', () => {
    const v = dayView({ date: day.date, day, fallback, workouts: ticked })
    expect(v.workouts[0]?.kcal).toBe(workoutKcal(64, 50))
  })

  it('a day she entered nothing on is the resting figure alone — and says so with activeKcal 0', () => {
    const v = dayView({ date: '2026-10-11', day: null, fallback, workouts: [] })
    expect(v).toMatchObject({ basalKcal: 1400, activeKcal: 0, totalKcal: 1400, steps: null })
  })

  it('a ticked programme day counts even with no day document — ticking it WAS the entry', () => {
    const v = dayView({ date: '2026-10-12', day: null, fallback, workouts: ticked })
    expect(v.activeKcal).toBe(workoutKcal(70, 50))
  })
})

describe('display', () => {
  it('shows an estimate to the nearest ten', () => {
    expect(roundForDisplay(1828)).toBe(1830)
    expect(roundForDisplay(1340)).toBe(1340)
  })
})

describe('a screen that showed calories but no time', () => {
  it('gets the minutes at which that machine would have shown that figure', () => {
    // treadmill 7 MET at 64 kg = 7,47 kcal/min gross → 180 kcal ≈ 24 min
    expect(minutesFromDisplayedKcal({ machine: 'treadmill', weightKg: 64, displayedKcal: 180 })).toBe(24)
  })

  it('is never zero — a session happened', () => {
    expect(minutesFromDisplayedKcal({ machine: 'stairs', weightKg: 120, displayedKcal: 1 })).toBe(1)
  })
})
