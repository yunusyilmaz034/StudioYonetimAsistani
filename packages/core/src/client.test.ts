import { describe, expect, it } from 'vitest'

import { compareMeasurements, type MemberMeasurement } from './client'

const m = (over: Partial<MemberMeasurement> & { takenOn: string }): MemberMeasurement => ({
  id: `mea_${over.takenOn}`,
  weightKg: null,
  fatPercent: null,
  musclePercent: null,
  waterPercent: null,
  bmi: null,
  bmr: null,
  visceralFat: null,
  circumferences: {},
  note: '',
  recordedAt: 0,
  ...over,
})

describe('compareMeasurements — the numbers, never a verdict', () => {
  it('reports the change between the two most recent readings, with the day gap', () => {
    const c = compareMeasurements([
      m({ takenOn: '2026-08-01', weightKg: 65, muscleKg: 42 }),
      m({ takenOn: '2026-06-01', weightKg: 67.4, muscleKg: 40.75 }),
    ])
    expect(c).not.toBeNull()
    expect(c!.fromDate).toBe('2026-06-01')
    expect(c!.toDate).toBe('2026-08-01')
    expect(c!.days).toBe(61)
    expect(c!.rows).toContainEqual({ key: 'weightKg', label: 'Kilo', unit: 'kg', from: 67.4, to: 65, diff: -2.4 })
    expect(c!.rows).toContainEqual({ key: 'muscleKg', label: 'Kas', unit: 'kg', from: 40.75, to: 42, diff: 1.3 })
  })

  it('is order-independent — a reversed list must not invert every sign', () => {
    const older = m({ takenOn: '2026-06-01', weightKg: 67 })
    const newer = m({ takenOn: '2026-08-01', weightKg: 65 })
    const a = compareMeasurements([newer, older])
    const b = compareMeasurements([older, newer])
    expect(a).toEqual(b)
    expect(a!.rows[0]!.diff).toBe(-2)
  })

  it('compares only what BOTH readings carry — a new metric has no change', () => {
    const c = compareMeasurements([
      m({ takenOn: '2026-08-01', weightKg: 65, fatKg: 20 }),
      m({ takenOn: '2026-06-01', weightKg: 67 }),
    ])
    expect(c!.rows.map((r) => r.key)).toEqual(['weightKg']) // fatKg is absent, never 20 − 0
  })

  it('drops an unchanged field and returns null when nothing moved at all', () => {
    expect(
      compareMeasurements([m({ takenOn: '2026-08-01', weightKg: 65 }), m({ takenOn: '2026-06-01', weightKg: 65 })]),
    ).toBeNull()
  })

  it('needs two readings', () => {
    expect(compareMeasurements([])).toBeNull()
    expect(compareMeasurements([m({ takenOn: '2026-08-01', weightKg: 65 })])).toBeNull()
  })

  it('compares circumferences by region', () => {
    const c = compareMeasurements([
      m({ takenOn: '2026-08-01', circumferences: { Bel: 72, Kalça: 96 } }),
      m({ takenOn: '2026-06-01', circumferences: { Bel: 76 } }),
    ])
    expect(c!.rows).toEqual([{ key: 'circ:Bel', label: 'Bel', unit: 'cm', from: 76, to: 72, diff: -4 }])
  })
})
