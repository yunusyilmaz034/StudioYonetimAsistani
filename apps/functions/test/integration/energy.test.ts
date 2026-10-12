import {
  FirestoreEnergyRepository,
  addLocalDays,
  energyDays,
  energyToday,
  logEnergyCardio,
  logEnergySteps,
  removeEnergyCardio,
  setEnergyWorkoutMinutes,
  startEnergyTracking,
  stopEnergyTracking,
  summaryIsDue,
  systemClock,
  type EnergyDeps,
  type StudioId,
  type TenantContext,
  type TickedWorkout,
} from '@studio/core'
import { describe, expect, it } from 'vitest'

import { db } from '../../src/shared/firebase'

// KALORİ TAKİBİ, against a real database (2026-10-13).
//
// The deciders are unit-tested. What only a database can answer:
//   · the day range is read by DOCUMENT ID (`${memberId}_${date}`) — does it return this member's
//     days and nobody else's, in particular not a member whose id shares a prefix?
//   · stopping ERASES — is anything of hers left behind?
//   · does every write land with its event, and does any event carry a number she could be weighed by?

const SID = `std_energy_${Date.now()}` as StudioId
const ctx = (memberId: string): TenantContext => ({ studioId: SID, branchIds: [], role: 'member' as never, actor: { type: 'member', id: memberId as never } })

const ticked: TickedWorkout[] = []
const deps: EnergyDeps = {
  repo: new FirestoreEnergyRepository(db()),
  workouts: { tickedBetween: async (_c, memberId, from, to) => ticked.filter((t) => t.workoutLogId.startsWith(memberId) && t.date >= from && t.date <= to) },
  clock: systemClock,
  utcOffsetMinutes: 180,
}
const today = energyToday(deps)
const wizard = { sex: 'female' as const, weightKg: 64, heightCm: 165, birthYear: 1992, bodyFatPercent: null, goal: 'lose' as const, consent: true }

describe('kalori takibi — veritabanına karşı', () => {
  it('a day is built up entry by entry, and read back as she would see it', async () => {
    const M = 'mem_a'
    expect((await startEnergyTracking(deps, ctx(M), { ...wizard, memberId: M }, 'test')).ok).toBe(true)
    expect((await startEnergyTracking(deps, ctx(M), { ...wizard, memberId: M }, 'test')).ok).toBe(false) // already started

    expect((await logEnergySteps(deps, ctx(M), { memberId: M, date: today, steps: 6200 }, 'test')).ok).toBe(true)
    const cardio = await logEnergyCardio(deps, ctx(M), { memberId: M, date: today, machine: 'treadmill', minutes: 22, distanceKm: 2.4, displayedKcal: 180, source: 'photo' }, 'test')
    expect(cardio.ok).toBe(true)

    ticked.push({ workoutLogId: `${M}_wkl_1`, date: today, label: 'Alt Vücut · Gün 2', estimatedMinutes: 50 })
    const r = await energyDays(deps, ctx(M), M, addLocalDays(today, -6), today)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // She started today: the six days before she existed here are not shown as rest days.
    expect(r.value.days.map((d) => d.date)).toEqual([today])
    expect(r.value.days[0]).toMatchObject({ stepsKcal: 198, workoutKcal: 133, cardioKcal: 157, activeKcal: 488 })
    expect(summaryIsDue(r.value.days[0]!)).toBe(true)

    // Her correction to the programme day's duration, then removing the cardio session.
    expect((await setEnergyWorkoutMinutes(deps, ctx(M), { memberId: M, date: today, workoutLogId: `${M}_wkl_1`, minutes: 70 }, 'test')).ok).toBe(true)
    expect((await setEnergyWorkoutMinutes(deps, ctx(M), { memberId: M, date: today, workoutLogId: 'not_hers', minutes: 70 }, 'test')).ok).toBe(false)
    if (cardio.ok) expect((await removeEnergyCardio(deps, ctx(M), { memberId: M, date: today, entryId: cardio.value.cardio[0]!.id }, 'test')).ok).toBe(true)
    const after = await energyDays(deps, ctx(M), M, today, today)
    expect(after.ok && after.value.days[0]).toMatchObject({ workoutKcal: 187, cardioKcal: 0 })
  })

  it('reading one member’s days never returns another’s — not even one whose id shares a prefix', async () => {
    for (const M of ['mem_b', 'mem_b2']) {
      await startEnergyTracking(deps, ctx(M), { ...wizard, memberId: M }, 'test')
      await logEnergySteps(deps, ctx(M), { memberId: M, date: today, steps: M === 'mem_b' ? 1000 : 9000 }, 'test')
    }
    const days = await deps.repo.listDays(ctx('mem_b'), 'mem_b', addLocalDays(today, -7), today)
    expect(days.map((d) => d.memberId)).toEqual(['mem_b'])
    expect(days[0]?.steps?.count).toBe(1000)
  })

  it('no event carries a number she could be weighed by', async () => {
    const snap = await db().collection(`studios/${SID}/events`).get()
    const energy = snap.docs.map((d) => d.data()).filter((e) => String(e.type).startsWith('energy_'))
    expect(energy.length).toBeGreaterThan(5)
    const allowed = new Set(['hasBodyFat', 'fields', 'daysErased', 'date', 'replaced', 'entryId', 'machine', 'source', 'hadDisplayedKcal', 'workoutLogId'])
    for (const e of energy) for (const key of Object.keys(e.payload ?? {})) expect(allowed.has(key), `${e.type}.${key}`).toBe(true)
  })

  it('stopping erases her profile and every day, and leaves the fact that it happened', async () => {
    const M = 'mem_a'
    const r = await stopEnergyTracking(deps, ctx(M), M, 'test')
    expect(r.ok && r.value.daysErased).toBe(1)
    expect(await deps.repo.getProfile(ctx(M), M)).toBeNull()
    expect(await deps.repo.listDays(ctx(M), M, addLocalDays(today, -30), today)).toEqual([])
    expect((await energyDays(deps, ctx(M), M, today, today)).ok).toBe(false)
    // Somebody else's data is untouched.
    expect(await deps.repo.getProfile(ctx('mem_b'), 'mem_b')).not.toBeNull()
    const stopped = await db().collection(`studios/${SID}/events`).where('type', '==', 'energy_tracking.stopped').get()
    expect(stopped.size).toBe(1)
  })
})
