import { describe, expect, it } from 'vitest'

import { decideCompleteWorkoutDay, decideUndoWorkoutDay, type DecideContext } from '../../src/modules/training/domain/decide'
import type { WorkoutLog } from '../../src/modules/training/domain/types'
import { instant, type ActorRef, type CorrelationId, type StudioId } from '../../src/shared'
import completed from './workout.day_completed.v1.json'

// The payload SHAPE is a contract: once written, an event is never edited and never deleted, so a
// field added or renamed here is a permanent fork in the log. The fixture is the agreed shape; this
// test fails the day the code drifts from it.
//
// It also guards #6 the only way that works — by naming every key that is allowed to exist. Sets,
// weights and her note live on the log document under her member scope, never in the event.

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'member', id: 'mem_1' } as unknown as ActorRef,
  now: instant(1_800_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'member_app',
}

const log: WorkoutLog = {
  id: 'wkl_01K000000000000000000000',
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1',
  programId: 'prg_01K000000000000000000000',
  programVersion: 3,
  dayOrder: 1,
  performedOn: '2026-08-06',
  entries: [
    { exerciseId: 'ex_1', sets: 3, reps: '12', weightGrams: 12_000, skipped: false },
    { exerciseId: 'ex_2', sets: null, reps: '10', weightGrams: null, skipped: false },
    { exerciseId: 'ex_3', sets: null, reps: null, weightGrams: 8_000, skipped: false },
    { exerciseId: 'ex_4', sets: null, reps: null, weightGrams: null, skipped: true },
    { exerciseId: 'ex_5', sets: null, reps: null, weightGrams: null, skipped: false },
    { exerciseId: 'ex_6', sets: null, reps: null, weightGrams: null, skipped: false },
  ],
  note: 'belim biraz ağrıdı, ağırlığı düşürdüm',
  completedAt: instant(1_800_000_000_000),
  undoneAt: null,
}

describe('golden · workout.day_completed v1', () => {
  it('matches the agreed payload shape', () => {
    const r = decideCompleteWorkoutDay(ctx, { log, dayCount: 3, completedCount: 0 })
    if (!r.ok) throw new Error('unreachable')
    expect(r.value.events[0]!.payload).toEqual(completed)
  })

  it('carries no PII — not her note, not a weight', () => {
    const r = decideCompleteWorkoutDay(ctx, { log, dayCount: 3, completedCount: 0 })
    if (!r.ok) throw new Error('unreachable')
    const raw = JSON.stringify(r.value.events[0]!.payload)
    for (const forbidden of ['belim', 'ağrıdı', '12000', '8000']) expect(raw).not.toContain(forbidden)
  })
})

describe('golden · workout.day_undone v1', () => {
  it('carries the reason and nothing else about her', () => {
    const r = decideUndoWorkoutDay(ctx, log, 'yanlış günü işaretledim', instant(1_800_000_100_000))
    if (!r.ok) throw new Error('unreachable')
    expect(r.value.events[0]!.payload).toEqual({
      logId: 'wkl_01K000000000000000000000',
      programId: 'prg_01K000000000000000000000',
      dayOrder: 1,
      reason: 'yanlış günü işaretledim',
    })
  })
})
