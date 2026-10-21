import { describe, expect, it } from 'vitest'

import { decideCompleteWorkoutDay, decideRemoveMeasurement, decideRetractProgramVersion, decideUndoWorkoutDay, type DecideContext } from '../../src/modules/training/domain/decide'
import type { WorkoutLog } from '../../src/modules/training/domain/types'
import { instant, type ActorRef, type CorrelationId, type StudioId } from '../../src/shared'
import completed from './workout.day_completed.v1.json'
import retracted from './program.version_retracted.v1.json'
import removed from './measurement.removed.v1.json'

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


// ── program.version_retracted (owner onayı, 2026-09-03) ─────────────────────────────────────
//
// `becameCurrent` sözleşmenin parçası ve kolayca atlanabilecek alan: onsuz "üye o an hangi programı
// görüyordu" sorusu log'dan cevaplanamaz. `reason` da öyle — geri çekmenin sebebi olayın içinde
// durmazsa, bir yıl sonra "bu neden kalktı" sorusunun cevabı yoktur.
//
// PII yok: gün adları, egzersizler ve notlar olaya HİÇ girmez — program belgesinde dururlar.
describe('program.version_retracted v1', () => {
  const program = {
    id: 'prg_01K000000000000000000000',
    studioId: 'std_1',
    memberId: 'mem_1',
    trainerId: 'trn_1',
    title: 'Program A',
    status: 'active',
    startsOn: null,
    endsOn: null,
    currentVersion: 3,
    versions: [1, 2, 3].map((n) => ({
      version: n,
      note: '',
      days: [{ order: 1, name: '1. Gün', exercises: [] }],
      publishedBy: ctx.actor,
      publishedAt: ctx.now,
    })),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  } as never

  it('payload sabit sözleşmeye uyuyor', () => {
    const r = decideRetractProgramVersion(ctx, program, 3, 'Yanlışlıkla iki kez yayınlandı')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual(retracted)
  })

  it('payload üyeye ait hiçbir içerik taşımıyor', () => {
    const r = decideRetractProgramVersion(ctx, program, 3, 'sebep')
    if (!r.ok) return
    expect(Object.keys(r.value.events[0]!.payload as object).sort()).toEqual(
      ['becameCurrent', 'programId', 'reason', 'version'].sort(),
    )
  })
})

describe('golden · measurement.removed v1 (owner, 2026-10-21)', () => {
  const m = {
    id: 'msr_01K000000000000000000000',
    studioId: 'std_1',
    memberId: 'mem_1',
    takenOn: '2026-10-20',
    weightKg: 68.4,
    fatPercent: 31.2,
    circumferences: { bel: 82 },
    note: 'yanlış girildi, başka üyenin tartısı',
  } as never

  it('matches the agreed payload shape', () => {
    const r = decideRemoveMeasurement(ctx, m, 'wrong_entry')
    if (!r.ok) throw new Error(r.error.code)
    expect(r.value[0]?.type).toBe('measurement.removed')
    expect(r.value[0]?.payload).toEqual(removed)
  })

  it('carries no body value and no free text — the numbers leave with the record', () => {
    const r = decideRemoveMeasurement(ctx, m, 'wrong_member')
    if (!r.ok) throw new Error(r.error.code)
    expect(Object.keys(r.value[0]!.payload as object).sort()).toEqual(['measurementId', 'reason', 'takenOn'])
  })

  it.each(['', 'yanlış', 'other'])('refuses a reason outside the closed list: %j', (reason) => {
    const r = decideRemoveMeasurement(ctx, m, reason)
    expect(r.ok ? 'ok' : r.error.code).toBe('reason_required')
  })
})
