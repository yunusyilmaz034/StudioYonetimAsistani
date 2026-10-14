import { describe, expect, it } from 'vitest'

import { instant, type ActorRef, type CorrelationId, type StudioId } from '../../../shared'
import {
  decideLogCardio,
  decideLogMeal,
  decideLogSteps,
  decideRemoveCardio,
  decideRemoveMeal,
  decideSetMealPrefs,
  decideUpdateMeal,
  decideSetWorkoutMinutes,
  decideStartTracking,
  decideStopTracking,
  decideUpdateProfile,
  type DecideContext,
} from './decide'
import type { EnergyDay, EnergyProfile } from './types'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'member', id: 'mem_1' } as unknown as ActorRef,
  now: instant(1_800_000_000_000),
  today: '2026-10-13',
  correlationId: 'cor_1' as CorrelationId,
  source: 'member_app',
}

const input = { memberId: 'mem_1', sex: 'female' as const, weightKg: 64, heightCm: 165, birthYear: 1992, bodyFatPercent: null, goal: 'lose' as const, consent: true }
const started = (): EnergyProfile => {
  const r = decideStartTracking(ctx, null, input)
  if (!r.ok) throw new Error('fixture')
  return r.value.next
}
const types = (r: { ok: true; value: { events: { type: string }[] } } | { ok: false }) => (r.ok ? r.value.events.map((e) => e.type) : [])
const code = (r: { ok: boolean; error?: { code: string; field?: string } }) => (r.ok ? null : r.error)

describe('starting', () => {
  it('stores what the wizard gave and stamps the consent', () => {
    const r = decideStartTracking(ctx, null, input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next).toMatchObject({ weightKg: 64, goal: 'lose', sex: 'female', consentedAt: ctx.now })
    expect(types(r)).toEqual(['energy_tracking.started'])
  })

  it('is refused without consent — the checkbox is not the UI’s to forget', () => {
    expect(code(decideStartTracking(ctx, null, { ...input, consent: false }))).toEqual({ code: 'energy_consent_required' })
  })

  it('is refused when she already has a profile', () => {
    expect(code(decideStartTracking(ctx, started(), input))).toEqual({ code: 'energy_already_started' })
  })

  it.each([
    ['weightKg', { weightKg: 640 }],
    ['weightKg', { weightKg: 29.9 }],
    ['heightCm', { heightCm: 1.65 }],
    ['birthYear', { birthYear: 92 }],
    ['birthYear', { birthYear: 2020 }],
    ['birthYear', { birthYear: 1992.5 }],
    ['bodyFatPercent', { bodyFatPercent: 0.27 }],
    ['bodyFatPercent', { bodyFatPercent: 61 }],
  ])('names the field and stores nothing: %s %o', (field, over) => {
    expect(code(decideStartTracking(ctx, null, { ...input, ...over }))).toEqual({ code: 'energy_profile_invalid', field })
  })

  it('accepts the edges of each range', () => {
    expect(decideStartTracking(ctx, null, { ...input, weightKg: 30, heightCm: 220, birthYear: 2012, bodyFatPercent: 5 }).ok).toBe(true)
    expect(decideStartTracking(ctx, null, { ...input, weightKg: 250, heightCm: 120, birthYear: 1931, bodyFatPercent: 60 }).ok).toBe(true)
  })
})

describe('the event never carries her body', () => {
  it('says only whether the tighter formula is in use', () => {
    const r = decideStartTracking(ctx, null, { ...input, bodyFatPercent: 27 })
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual({ hasBodyFat: true })
  })

  it('a profile edit names the FIELDS that changed, never the values', () => {
    const r = decideUpdateProfile(ctx, started(), { weightKg: 62.5, heightCm: 165, birthYear: 1992, bodyFatPercent: 26, goal: 'lose' })
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual({ fields: ['weightKg', 'bodyFatPercent'] })
    expect(r.value.next.weightKg).toBe(62.5)
  })

  it('saving the form unchanged is not a change', () => {
    const p = started()
    const r = decideUpdateProfile(ctx, p, { weightKg: 64, heightCm: 165, birthYear: 1992, bodyFatPercent: null, goal: 'lose' })
    expect(r.ok && r.value.events).toEqual([])
  })

  it('an edit cannot change the sex — that is the studio’s to supply', () => {
    const r = decideUpdateProfile(ctx, { ...started(), sex: 'male' }, { weightKg: 64, heightCm: 165, birthYear: 1992, bodyFatPercent: null, goal: 'gain' })
    expect(r.ok && r.value.next.sex).toBe('male')
  })
})

describe('steps', () => {
  it('opens the day with today’s body stamped on it', () => {
    const r = decideLogSteps(ctx, started(), null, { date: '2026-10-13', steps: 6200 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next).toMatchObject({ id: 'mem_1_2026-10-13', weightKg: 64, basalKcal: 1340, steps: { count: 6200, kcal: 198 } })
    expect(r.value.events[0]?.payload).toEqual({ date: '2026-10-13', replaced: false })
  })

  it('is the day’s TOTAL: typing it again replaces, and says so', () => {
    const first = decideLogSteps(ctx, started(), null, { date: '2026-10-13', steps: 6200 })
    if (!first.ok) return
    const r = decideLogSteps(ctx, started(), first.value.next, { date: '2026-10-13', steps: 8000 })
    if (!r.ok) return
    expect(r.value.next.steps?.count).toBe(8000)
    expect(r.value.events[0]?.payload).toEqual({ date: '2026-10-13', replaced: true })
  })

  it('keeps the weight the day was opened with, even after she edits her profile', () => {
    const first = decideLogSteps(ctx, started(), null, { date: '2026-10-13', steps: 1000 })
    if (!first.ok) return
    const r = decideLogSteps(ctx, { ...started(), weightKg: 80 }, first.value.next, { date: '2026-10-13', steps: 10_000 })
    expect(r.ok && r.value.next.steps?.kcal).toBe(320) // 10.000 × 64 × 0,0005 — not × 80
  })

  it.each([-1, 100_001, 12.5, Number.NaN])('refuses %s', (steps) => {
    expect(code(decideLogSteps(ctx, started(), null, { date: '2026-10-13', steps }))).toEqual({ code: 'energy_entry_invalid', field: 'steps' })
  })

  it('accepts zero — a day spent on the sofa is a fact', () => {
    expect(decideLogSteps(ctx, started(), null, { date: '2026-10-13', steps: 0 }).ok).toBe(true)
  })

  it('is refused before she has started', () => {
    expect(code(decideLogSteps(ctx, null, null, { date: '2026-10-13', steps: 10 }))).toEqual({ code: 'energy_not_started' })
  })
})

describe('which days can be written', () => {
  const log = (date: string) => decideLogSteps(ctx, started(), null, { date, steps: 10 })

  it('today and exactly seven days back — not eight, and not tomorrow', () => {
    expect(log('2026-10-13').ok).toBe(true)
    expect(log('2026-10-06').ok).toBe(true)
    expect(code(log('2026-10-05'))).toEqual({ code: 'energy_date_out_of_range' })
    expect(code(log('2026-10-14'))).toEqual({ code: 'energy_date_out_of_range' })
  })

  it('refuses a date that is not a date', () => {
    expect(code(log('13.10.2026'))).toEqual({ code: 'energy_date_out_of_range' })
  })
})

describe('cardio', () => {
  const cardio = { date: '2026-10-13', entryId: 'crd_1', machine: 'treadmill' as const, minutes: 22, distanceKm: 2.4, displayedKcal: 180, source: 'photo' as const }

  it('adds a session priced net of rest, and the event carries no number she could be weighed by', () => {
    const r = decideLogCardio(ctx, started(), null, cardio)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.cardio).toHaveLength(1)
    expect(r.value.next.cardio[0]).toMatchObject({ kcal: 157, displayedKcal: 180, source: 'photo' })
    expect(r.value.events[0]?.payload).toEqual({ date: '2026-10-13', entryId: 'crd_1', machine: 'treadmill', source: 'photo', hadDisplayedKcal: true })
  })

  it('two sessions in a day are two sessions — unlike steps, they add', () => {
    const a = decideLogCardio(ctx, started(), null, cardio)
    if (!a.ok) return
    const b = decideLogCardio(ctx, started(), a.value.next, { ...cardio, entryId: 'crd_2', machine: 'bike', displayedKcal: null })
    expect(b.ok && b.value.next.cardio.map((c) => c.id)).toEqual(['crd_1', 'crd_2'])
    expect(b.ok && b.value.events[0]?.payload).toMatchObject({ hadDisplayedKcal: false })
  })

  it.each([
    ['minutes', { minutes: 0 }],
    ['minutes', { minutes: 301 }],
    ['kcal', { displayedKcal: 0 }],
    ['kcal', { displayedKcal: 3001 }],
    ['distanceKm', { distanceKm: -1 }],
  ])('refuses a bad %s', (field, over) => {
    expect(code(decideLogCardio(ctx, started(), null, { ...cardio, ...over }))).toEqual({ code: 'energy_entry_invalid', field })
  })

  it('removing takes the session out and leaves the rest of the day alone', () => {
    const a = decideLogCardio(ctx, started(), null, cardio)
    if (!a.ok) return
    const r = decideRemoveCardio(ctx, a.value.next, 'crd_1')
    expect(r.ok && r.value.next.cardio).toEqual([])
    expect(types(r)).toEqual(['energy_day.cardio_removed'])
    expect(code(decideRemoveCardio(ctx, a.value.next, 'crd_9'))).toEqual({ code: 'energy_entry_not_found' })
    expect(code(decideRemoveCardio(ctx, null, 'crd_1'))).toEqual({ code: 'energy_entry_not_found' })
  })

  it('a session on a day now too old to write cannot be removed either', () => {
    const old: EnergyDay = { id: 'mem_1_2026-10-01', studioId: ctx.studioId, memberId: 'mem_1', date: '2026-10-01', weightKg: 64, basalKcal: 1340, steps: null, cardio: [{ id: 'crd_1', machine: 'bike', minutes: 10, distanceKm: null, displayedKcal: null, source: 'manual', kcal: 62, loggedAt: ctx.now }], workoutMinutes: {}, meals: [], updatedAt: ctx.now }
    expect(code(decideRemoveCardio(ctx, old, 'crd_1'))).toEqual({ code: 'energy_date_out_of_range' })
  })
})

describe('her correction to a programme day’s duration', () => {
  it('is stored by workout-log id; the workout itself is not copied', () => {
    const r = decideSetWorkoutMinutes(ctx, started(), null, { date: '2026-10-13', workoutLogId: 'wkl_1', minutes: 70 })
    expect(r.ok && r.value.next.workoutMinutes).toEqual({ wkl_1: 70 })
    expect(r.ok && r.value.events[0]?.payload).toEqual({ date: '2026-10-13', workoutLogId: 'wkl_1' })
  })

  it('refuses a duration that is not one', () => {
    expect(code(decideSetWorkoutMinutes(ctx, started(), null, { date: '2026-10-13', workoutLogId: 'wkl_1', minutes: 0 }))).toEqual({ code: 'energy_entry_invalid', field: 'minutes' })
  })
})

describe('stopping', () => {
  it('records that her data was erased, and how many days of it', () => {
    const r = decideStopTracking(ctx, started(), 12)
    expect(r.ok && r.value.events[0]).toMatchObject({ type: 'energy_tracking.stopped', payload: { daysErased: 12 } })
  })

  it('is refused when there is nothing to stop', () => {
    expect(code(decideStopTracking(ctx, null, 0))).toEqual({ code: 'energy_not_started' })
  })
})

// ── MEALS (owner, 2026-10-14 · 1.9.0) ─────────────────────────────────────────────────────────
describe('meals', () => {
  const plate = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-13',
    entryId: 'mel_1',
    slot: 'lunch' as const,
    source: 'photo' as const,
    items: [
      { name: 'Izgara tavuk', portion: 'normal' as const, kcalNormal: 280 },
      { name: 'Bulgur pilavı', portion: 'large' as const, kcalNormal: 230 },
      { name: 'Salata', portion: 'small' as const, kcalNormal: 100 },
    ],
    ...over,
  })

  it('prices each line by its portion and the meal as their sum', () => {
    const r = decideLogMeal(ctx, started(), null, plate())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const meal = r.value.next.meals[0]!
    expect(meal.items.map((i) => i.kcal)).toEqual([280, 345, 60])
    expect(meal.kcal).toBe(685)
    expect(types(r)).toEqual(['energy_day.meal_logged'])
  })

  it('the same id twice is one meal — a retried tap does not eat twice', () => {
    const a = decideLogMeal(ctx, started(), null, plate())
    if (!a.ok) throw new Error('fixture')
    const b = decideLogMeal(ctx, started(), a.value.next, plate())
    expect(b.ok && b.value.next.meals).toHaveLength(1)
    expect(types(b)).toEqual([])
  })

  it('refuses, never clamps — and says which field', () => {
    const p = started()
    expect(code(decideLogMeal(ctx, p, null, plate({ items: [] })))).toEqual({ code: 'energy_entry_invalid', field: 'items' })
    expect(code(decideLogMeal(ctx, p, null, plate({ items: Array.from({ length: 21 }, () => ({ name: 'x', portion: 'normal', kcalNormal: 10 })) })))).toEqual({ code: 'energy_entry_invalid', field: 'items' })
    expect(code(decideLogMeal(ctx, p, null, plate({ items: [{ name: '  ', portion: 'normal', kcalNormal: 10 }] })))).toEqual({ code: 'energy_entry_invalid', field: 'name' })
    expect(code(decideLogMeal(ctx, p, null, plate({ items: [{ name: 'x', portion: 'huge', kcalNormal: 10 }] })))).toEqual({ code: 'energy_entry_invalid', field: 'portion' })
    expect(code(decideLogMeal(ctx, p, null, plate({ items: [{ name: 'x', portion: 'normal', kcalNormal: 3001 }] })))).toEqual({ code: 'energy_entry_invalid', field: 'mealKcal' })
    expect(code(decideLogMeal(ctx, p, null, plate({ items: [{ name: 'x', portion: 'normal', kcalNormal: 12.5 }] })))).toEqual({ code: 'energy_entry_invalid', field: 'mealKcal' })
    expect(code(decideLogMeal(ctx, p, null, plate({ slot: 'brunch' })))).toEqual({ code: 'energy_entry_invalid', field: 'slot' })
    // Boundaries: 3.000 and 0 are allowed (water is 0), 20 lines are allowed.
    expect(decideLogMeal(ctx, p, null, plate({ items: [{ name: 'Su', portion: 'normal', kcalNormal: 0 }, { name: 'Pizza', portion: 'normal', kcalNormal: 3000 }] })).ok).toBe(true)
    expect(decideLogMeal(ctx, p, null, plate({ items: Array.from({ length: 20 }, () => ({ name: 'x', portion: 'normal', kcalNormal: 10 })) })).ok).toBe(true)
  })

  it('not tomorrow, not older than a week', () => {
    expect(code(decideLogMeal(ctx, started(), null, plate({ date: '2026-10-14' })))).toEqual({ code: 'energy_date_out_of_range' })
    expect(code(decideLogMeal(ctx, started(), null, plate({ date: '2026-10-05' })))).toEqual({ code: 'energy_date_out_of_range' })
    expect(decideLogMeal(ctx, started(), null, plate({ date: '2026-10-06' })).ok).toBe(true)
  })

  it('switched off: nothing is added', () => {
    const p = decideSetMealPrefs(ctx, started(), { mealsEnabled: false, hideIntake: false })
    if (!p.ok) throw new Error('fixture')
    expect(code(decideLogMeal(ctx, p.value.next, null, plate()))).toEqual({ code: 'energy_meals_off' })
  })

  it('a correction re-prices from the normal estimate and keeps the id; unchanged is no event', () => {
    const a = decideLogMeal(ctx, started(), null, plate())
    if (!a.ok) throw new Error('fixture')
    const r = decideUpdateMeal(ctx, a.value.next, { entryId: 'mel_1', slot: 'dinner', items: [{ name: 'Izgara tavuk', portion: 'large', kcalNormal: 280 }] })
    expect(r.ok && r.value.next.meals[0]).toMatchObject({ id: 'mel_1', slot: 'dinner', kcal: 420 })
    const same = decideUpdateMeal(ctx, a.value.next, { entryId: 'mel_1', slot: 'lunch', items: plate().items })
    expect(types(same)).toEqual([])
    expect(code(decideUpdateMeal(ctx, a.value.next, { entryId: 'mel_9', slot: 'lunch', items: plate().items }))).toEqual({ code: 'energy_entry_not_found' })
  })

  it('removing takes it off the day and the intake', () => {
    const a = decideLogMeal(ctx, started(), null, plate())
    if (!a.ok) throw new Error('fixture')
    const r = decideRemoveMeal(ctx, a.value.next, 'mel_1')
    expect(r.ok && r.value.next.meals).toEqual([])
    expect(code(decideRemoveMeal(ctx, a.value.next, 'mel_9'))).toEqual({ code: 'energy_entry_not_found' })
  })

  it('a new profile starts with meals on and figures shown', () => {
    expect(started()).toMatchObject({ mealsEnabled: true, hideIntake: false })
  })
})
