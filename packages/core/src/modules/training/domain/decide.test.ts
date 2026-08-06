import { describe, expect, it } from 'vitest'

import { instant, type ActorRef, type CorrelationId, type StudioId } from '../../../shared'
import {
  cycleState,
  decideChangeProgramStatus,
  decideCompleteWorkoutDay,
  decidePublishVersion,
  decideRecordMeasurement,
  decideUndoWorkoutDay,
  type DecideContext,
} from './decide'
import type { Measurement, Program, ProgramDay, WorkoutLog } from './types'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'trainer', id: 'stf_1' } as unknown as ActorRef,
  now: instant(1_800_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const day = (): ProgramDay => ({
  order: 1,
  name: 'Gün 1',
  exercises: [{ exerciseId: 'ex_1', order: 1, nameTr: 'Squat', videoUrl: null, description: '', sets: 3, reps: '12', restSeconds: 60, tempo: '2-0-2', note: '', alternativeExerciseId: null }],
})

const program = (over: Partial<Program> = {}): Program => ({
  id: 'prg_1',
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1',
  trainerId: 'stf_1',
  title: 'Başlangıç',
  status: 'draft',
  startsOn: null,
  endsOn: null,
  currentVersion: 0,
  versions: [],
  createdAt: ctx.now,
  updatedAt: ctx.now,
  ...over,
})

describe('decidePublishVersion — a programme is never edited, only versioned (§4/§6)', () => {
  it('publishes v1 from draft and activates the programme', () => {
    const r = decidePublishVersion(ctx, program(), [day()], 'ilk')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.currentVersion).toBe(1)
    expect(r.value.next.status).toBe('active')
    expect(r.value.next.versions).toHaveLength(1)
    expect(r.value.events[0]?.payload).toMatchObject({ version: 1, dayCount: 1, exerciseCount: 1 })
  })
  it('a new version is APPENDED — the old one is never touched', () => {
    const v1 = decidePublishVersion(ctx, program(), [day()], 'v1')
    if (!v1.ok) return
    const v2 = decidePublishVersion(ctx, v1.value.next, [day(), day()], 'v2')
    expect(v2.ok).toBe(true)
    if (!v2.ok) return
    expect(v2.value.next.currentVersion).toBe(2)
    expect(v2.value.next.versions).toHaveLength(2)
    expect(v2.value.next.versions[0]?.version).toBe(1) // v1 kept, unchanged
  })
  it('refuses an empty programme and an archived one', () => {
    expect(decidePublishVersion(ctx, program(), [], 'x').ok).toBe(false)
    const archived = decidePublishVersion(ctx, program({ status: 'archived' }), [day()], 'x')
    expect(archived.ok).toBe(false)
    if (!archived.ok) expect(archived.error.code).toBe('program_archived')
  })
})

describe('decideChangeProgramStatus', () => {
  it('is idempotent and refuses editing an archived programme', () => {
    const same = decideChangeProgramStatus(ctx, program({ status: 'active' }), 'active')
    expect(same.ok && same.value.events).toEqual([])
    expect(decideChangeProgramStatus(ctx, program({ status: 'archived' }), 'active').ok).toBe(false)
  })
})

describe('decideRecordMeasurement — the event carries WHICH metrics, never the values (PII)', () => {
  it('records the present metrics without leaking a number', () => {
    const m: Measurement = {
      id: 'mea_1', studioId: 'std_1' as StudioId, memberId: 'mem_1', takenOn: '2026-08-01',
      weightKg: 62.4, fatPercent: 22, musclePercent: null, waterPercent: null, bmi: 21.5, bmr: null, visceralFat: null,
      idealWeightKg: null, leanMassKg: null, leanMassPercent: null, muscleKg: null, waterKg: null, fatKg: null,
      circumferences: { bel: 70 }, note: '', correctedFrom: null, recordedBy: ctx.actor, recordedAt: ctx.now,
    }
    const r = decideRecordMeasurement(ctx, m)
    const json = JSON.stringify(r.events[0]?.payload)
    expect(json).not.toContain('62.4')
    expect(json).not.toContain('70')
    expect(r.events[0]?.payload).toMatchObject({ measurementId: 'mea_1', metrics: ['weightKg', 'fatPercent', 'bmi', 'bel'] })
  })
})

// ── WORKOUT LOG (v1.31) ─────────────────────────────────────────────────────────────────────
//
// The order is FIXED — 1 → 2 → 3 → 1 (owner: "sıralama atlamaya izin yok"). She may not jump ahead
// to the day she likes, and she may not repeat the day she just did.

describe('cycleState', () => {
  it('starts at day 1', () => {
    expect(cycleState(0, 3)).toEqual({ completed: 0, nextDayOrder: 1, rounds: 0 })
  })

  it('walks the cycle and wraps back to day 1', () => {
    expect(cycleState(1, 3).nextDayOrder).toBe(2)
    expect(cycleState(2, 3).nextDayOrder).toBe(3)
    expect(cycleState(3, 3).nextDayOrder).toBe(1) // wrapped
    expect(cycleState(4, 3).nextDayOrder).toBe(2)
  })

  it('counts full passes, which is what "4 haftadır bu programdasın" is built on', () => {
    expect(cycleState(2, 3).rounds).toBe(0)
    expect(cycleState(3, 3).rounds).toBe(1)
    expect(cycleState(11, 3).rounds).toBe(3)
  })

  // A one-day programme is a legitimate shape and must not divide by anything surprising.
  it('handles a single-day programme', () => {
    expect(cycleState(0, 1).nextDayOrder).toBe(1)
    expect(cycleState(5, 1)).toEqual({ completed: 5, nextDayOrder: 1, rounds: 5 })
  })
})

describe('decideCompleteWorkoutDay', () => {
  const log = (over: Partial<WorkoutLog> = {}): WorkoutLog => ({
    id: 'wkl_1',
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1',
    programId: 'prg_1',
    programVersion: 2,
    dayOrder: 1,
    performedOn: '2026-08-06',
    entries: [
      { exerciseId: 'ex_1', sets: 3, reps: '12', weightGrams: 12_000, skipped: false },
      { exerciseId: 'ex_2', sets: null, reps: null, weightGrams: null, skipped: false },
    ],
    note: '',
    completedAt: instant(1_800_000_000_000),
    undoneAt: null,
    ...over,
  })

  it('accepts the day the cycle says is next', () => {
    const r = decideCompleteWorkoutDay(ctx, { log: log(), dayCount: 3, completedCount: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]!.type).toBe('workout.day_completed')
  })

  it('REFUSES a day out of order, and says which one was expected', () => {
    const ahead = decideCompleteWorkoutDay(ctx, { log: log({ dayOrder: 3 }), dayCount: 3, completedCount: 0 })
    expect(ahead.ok).toBe(false)
    if (!ahead.ok && ahead.error.code === 'workout_day_out_of_order') expect(ahead.error.expected).toBe(1)
  })

  it('REFUSES the same day twice in a row', () => {
    const again = decideCompleteWorkoutDay(ctx, { log: log({ dayOrder: 1 }), dayCount: 3, completedCount: 1 })
    expect(again.ok).toBe(false)
  })

  it('accepts day 1 again once the cycle has wrapped', () => {
    const r = decideCompleteWorkoutDay(ctx, { log: log({ dayOrder: 1 }), dayCount: 3, completedCount: 3 })
    expect(r.ok).toBe(true)
  })

  // An untouched slot means "done as prescribed" — the common case, and it must cost no taps. Only
  // what she actually filled in is counted, so the payload can say how much of it she recorded.
  it('counts only the slots she filled in', () => {
    const r = decideCompleteWorkoutDay(ctx, { log: log(), dayCount: 3, completedCount: 0 })
    if (!r.ok) throw new Error('unreachable')
    const p = r.value.events[0]!.payload as { exerciseCount: number; loggedCount: number; hasNote: boolean }
    expect(p.exerciseCount).toBe(2)
    expect(p.loggedCount).toBe(1)
    expect(p.hasNote).toBe(false)
  })

  it('counts a skipped exercise as recorded — skipping is a fact she told us', () => {
    const r = decideCompleteWorkoutDay(ctx, {
      log: log({ entries: [{ exerciseId: 'ex_1', sets: null, reps: null, weightGrams: null, skipped: true }] }),
      dayCount: 3,
      completedCount: 0,
    })
    if (!r.ok) throw new Error('unreachable')
    expect((r.value.events[0]!.payload as { loggedCount: number }).loggedCount).toBe(1)
  })

  it('carries NO measurements, weights or note into the event (#6)', () => {
    const r = decideCompleteWorkoutDay(ctx, { log: log({ note: 'belim ağrıdı' }), dayCount: 3, completedCount: 0 })
    if (!r.ok) throw new Error('unreachable')
    const raw = JSON.stringify(r.value.events[0]!.payload)
    expect(raw).not.toContain('belim')
    expect(raw).not.toContain('12000')
    expect((r.value.events[0]!.payload as { hasNote: boolean }).hasNote).toBe(true)
  })

  it('refuses an empty programme', () => {
    const r = decideCompleteWorkoutDay(ctx, { log: log(), dayCount: 0, completedCount: 0 })
    expect(r.ok).toBe(false)
  })
})

describe('decideUndoWorkoutDay', () => {
  const done = (): WorkoutLog => ({
    id: 'wkl_1',
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1',
    programId: 'prg_1',
    programVersion: 2,
    dayOrder: 1,
    performedOn: '2026-08-06',
    entries: [],
    note: 'x',
    completedAt: instant(1_800_000_000_000),
    undoneAt: null,
  })

  // #9 — a correction is a compensating event, never a deletion. The log stays; it is marked.
  it('marks the log undone rather than deleting it', () => {
    const r = decideUndoWorkoutDay(ctx, done(), 'yanlış gün', instant(1_800_000_100_000))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.undoneAt).not.toBeNull()
    expect(r.value.events[0]!.type).toBe('workout.day_undone')
  })

  it('requires a reason', () => {
    const r = decideUndoWorkoutDay(ctx, done(), '   ', instant(1_800_000_100_000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('reason_required')
  })

  it('refuses to undo twice', () => {
    const r = decideUndoWorkoutDay(ctx, { ...done(), undoneAt: instant(1) }, 'yine', instant(2))
    expect(r.ok).toBe(false)
  })
})
