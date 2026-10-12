import { describe, expect, it } from 'vitest'

import {
  decideLogCardio,
  decideLogSteps,
  decideRemoveCardio,
  decideSetWorkoutMinutes,
  decideStartTracking,
  decideStopTracking,
  decideUpdateProfile,
  type DecideContext,
} from '../../src/modules/energy/domain/decide'
import { instant, type ActorRef, type CorrelationId, type StudioId } from '../../src/shared'
import type { EnergyDaySummaryDuePayload } from '../../src/modules/energy/events'
import summaryDue from './energy_day.summary_due.v1.json'
import cardioLogged from './energy_day.cardio_logged.v1.json'
import cardioRemoved from './energy_day.cardio_removed.v1.json'
import stepsLogged from './energy_day.steps_logged.v1.json'
import minutesSet from './energy_day.workout_minutes_set.v1.json'
import profileUpdated from './energy_tracking.profile_updated.v1.json'
import started from './energy_tracking.started.v1.json'
import stopped from './energy_tracking.stopped.v1.json'

// The payload SHAPE is a contract, and here it is also the privacy boundary (#6). `toEqual` names
// every key that is allowed to exist: weight, height, body fat — and steps, minutes and calories,
// from which the weight can be recovered by division — are absent because they are not listed, and
// this test fails the day someone adds one "for convenience".

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'member', id: 'mem_1' } as unknown as ActorRef,
  now: instant(1_800_000_000_000),
  today: '2026-10-13',
  correlationId: 'cor_1' as CorrelationId,
  source: 'member_app',
}
const wizard = { memberId: 'mem_1', sex: 'female' as const, weightKg: 64, heightCm: 165, birthYear: 1992, bodyFatPercent: 27, goal: 'lose' as const, consent: true }

describe('energy events', () => {
  const start = decideStartTracking(ctx, null, wizard)
  if (!start.ok) throw new Error('fixture')
  const profile = start.value.next

  it('energy_tracking.started', () => {
    expect(start.value.events[0]).toMatchObject({ type: 'energy_tracking.started', version: 1, payload: started })
    expect(start.value.events[0]?.payload).toEqual(started)
  })

  it('energy_tracking.profile_updated', () => {
    const r = decideUpdateProfile(ctx, profile, { weightKg: 62, heightCm: 165, birthYear: 1992, bodyFatPercent: 27, goal: 'maintain' })
    expect(r.ok && r.value.events[0]?.type).toBe('energy_tracking.profile_updated')
    expect(r.ok && r.value.events[0]?.payload).toEqual(profileUpdated)
  })

  it('energy_tracking.stopped', () => {
    const r = decideStopTracking(ctx, profile, 12)
    expect(r.ok && r.value.events[0]?.type).toBe('energy_tracking.stopped')
    expect(r.ok && r.value.events[0]?.payload).toEqual(stopped)
  })

  it('energy_day.steps_logged', () => {
    const r = decideLogSteps(ctx, profile, null, { date: '2026-10-13', steps: 6200 })
    expect(r.ok && r.value.events[0]?.type).toBe('energy_day.steps_logged')
    expect(r.ok && r.value.events[0]?.payload).toEqual(stepsLogged)
  })

  const cardio = decideLogCardio(ctx, profile, null, { date: '2026-10-13', entryId: 'crd_1', machine: 'treadmill', minutes: 22, distanceKm: 2.4, displayedKcal: 180, source: 'photo' })

  it('energy_day.cardio_logged', () => {
    expect(cardio.ok && cardio.value.events[0]?.type).toBe('energy_day.cardio_logged')
    expect(cardio.ok && cardio.value.events[0]?.payload).toEqual(cardioLogged)
  })

  it('energy_day.cardio_removed', () => {
    if (!cardio.ok) return
    const r = decideRemoveCardio(ctx, cardio.value.next, 'crd_1')
    expect(r.ok && r.value.events[0]?.type).toBe('energy_day.cardio_removed')
    expect(r.ok && r.value.events[0]?.payload).toEqual(cardioRemoved)
  })

  it('energy_day.workout_minutes_set', () => {
    const r = decideSetWorkoutMinutes(ctx, profile, null, { date: '2026-10-13', workoutLogId: 'wkl_1', minutes: 70 })
    expect(r.ok && r.value.events[0]?.type).toBe('energy_day.workout_minutes_set')
    expect(r.ok && r.value.events[0]?.payload).toEqual(minutesSet)
  })
})

// Emitted by the `system` sweep rather than by a decision function, so there is no decider to run:
// the fixture is checked against the payload TYPE, and the exact key set is asserted by hand. The day
// this event grows a calorie figure, both lines fail.
describe('energy_day.summary_due', () => {
  it('carries the date and nothing else', () => {
    const payload: EnergyDaySummaryDuePayload = summaryDue
    expect(Object.keys(payload)).toEqual(['date'])
  })
})
