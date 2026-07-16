import { describe, expect, it } from 'vitest'

import { instant, type ActorRef, type CorrelationId, type StudioId } from '../../../shared'
import { decideChangeProgramStatus, decidePublishVersion, decideRecordMeasurement, type DecideContext } from './decide'
import type { Measurement, Program, ProgramDay } from './types'

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
      circumferences: { bel: 70 }, note: '', correctedFrom: null, recordedBy: ctx.actor, recordedAt: ctx.now,
    }
    const r = decideRecordMeasurement(ctx, m)
    const json = JSON.stringify(r.events[0]?.payload)
    expect(json).not.toContain('62.4')
    expect(json).not.toContain('70')
    expect(r.events[0]?.payload).toMatchObject({ measurementId: 'mea_1', metrics: ['weightKg', 'fatPercent', 'bmi', 'bel'] })
  })
})
