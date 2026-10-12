import 'server-only'

import {
  DEFAULT_STUDIO_CONFIG,
  ENERGY_LIMITS,
  FirestoreEnergyRepository,
  FirestoreTrainingRepository,
  TrainingWorkoutSource,
  addLocalDays,
  energyDays,
  energyToday,
  logEnergyCardio,
  logEnergySteps,
  minutesFromDisplayedKcal,
  removeEnergyCardio,
  setEnergyWorkoutMinutes,
  startEnergyTracking,
  stopEnergyTracking,
  systemClock,
  updateEnergyProfile,
  type CardioEntry,
  type EnergyDayView,
  type EnergyDeps,
  type EnergySex,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import type { ApiResult, EnergyCardioWire, EnergyDayWire, EnergyPhotoResult, EnergyPrefill, EnergyState } from '@studio/core/client'
import { z } from 'zod'

import { isCardioPhotoMedia, readCardioPhoto } from './ai/cardio-photo'
import { adminDb } from './firebase-admin'

// The member's daily energy account, as the member API serves it (owner, 2026-10-13). Every function
// takes the `memberId` the Bearer token was verified to — never one from the request body.

const SOURCE = 'member_app'

// ── WHOSE BODY THE FORMULA ASSUMES ──────────────────────────────────────────────────────────
//
// This studio is women-only and the owner chose not to ask (*"kadınlara özel olacak"*). The resting
// equation still differs by sex, so the value is supplied HERE, once, and stored on each profile —
// the domain never assumes it. A second studio that needs the question adds a wizard step and reads
// this from its settings; no profile already written has to change.
const STUDIO_MEMBER_SEX: EnergySex = 'female'

/** How many days the home card and the history list show by default, and the most a request may ask for. */
const DEFAULT_DAYS = 7
const MAX_DAYS = 90

const deps = (): EnergyDeps => {
  const db = adminDb()
  return {
    repo: new FirestoreEnergyRepository(db),
    workouts: new TrainingWorkoutSource(new FirestoreTrainingRepository(db)),
    clock: systemClock,
    utcOffsetMinutes: DEFAULT_STUDIO_CONFIG.utcOffsetMinutes,
  }
}

const cardioWire = (c: CardioEntry): EnergyCardioWire => ({
  id: c.id,
  machine: c.machine,
  minutes: c.minutes,
  distanceKm: c.distanceKm,
  displayedKcal: c.displayedKcal,
  source: c.source,
  kcal: c.kcal,
})

const dayWire = (v: EnergyDayView, today: string): EnergyDayWire => ({
  date: v.date,
  basalKcal: v.basalKcal,
  steps: v.steps ? { count: v.steps.count, kcal: v.steps.kcal } : null,
  workouts: v.workouts,
  cardio: v.cardio.map(cardioWire),
  stepsKcal: v.stepsKcal,
  workoutKcal: v.workoutKcal,
  cardioKcal: v.cardioKcal,
  activeKcal: v.activeKcal,
  totalKcal: v.totalKcal,
  editable: v.date >= addLocalDays(today, -ENERGY_LIMITS.backfillDays),
})

/**
 * What the wizard can fill in before she types: the studio's latest measurement of her, her height
 * if the scale recorded one, and her birth year from her member record. Each may be missing, and a
 * missing one is simply an empty field — nothing is guessed.
 */
async function prefill(ctx: TenantContext, memberId: MemberId): Promise<EnergyPrefill> {
  const db = adminDb()
  const [measurements, member] = await Promise.all([
    new FirestoreTrainingRepository(db).listMeasurementsByMember(ctx, memberId as string),
    db.doc(`studios/${ctx.studioId}/members/${memberId}`).get(),
  ])
  const latest = [...measurements].filter((m) => m.weightKg !== null).sort((a, b) => b.takenOn.localeCompare(a.takenOn))[0] ?? null
  const birth = member.get('birthDate') as unknown
  const birthYear = typeof birth === 'string' && /^\d{4}-/.test(birth) ? Number(birth.slice(0, 4)) : null
  const height = latest?.circumferences?.heightCm ?? latest?.circumferences?.boy ?? null
  return {
    weightKg: latest?.weightKg ?? null,
    heightCm: typeof height === 'number' ? height : null,
    birthYear,
    bodyFatPercent: latest?.fatPercent ?? null,
    measuredOn: latest?.takenOn ?? null,
  }
}

export async function energyState(ctx: TenantContext, memberId: MemberId, days: number = DEFAULT_DAYS): Promise<EnergyState> {
  const d = deps()
  const today = energyToday(d)
  const span = Math.min(Math.max(1, Math.trunc(days) || DEFAULT_DAYS), MAX_DAYS)
  const r = await energyDays(d, ctx, memberId as string, addLocalDays(today, -(span - 1)), today)
  if (!r.ok) return { started: false, prefill: await prefill(ctx, memberId) }
  const p = r.value.profile
  return {
    started: true,
    today,
    profile: { weightKg: p.weightKg, heightCm: p.heightCm, birthYear: p.birthYear, bodyFatPercent: p.bodyFatPercent, goal: p.goal },
    days: r.value.days.map((v) => dayWire(v, today)),
  }
}

// Shapes only — the RANGES are the domain's to enforce and to name (it refuses, it does not clamp).
const num = z.number().finite()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const profileShape = z.object({
  weightKg: num,
  heightCm: num,
  birthYear: num,
  bodyFatPercent: num.nullable().default(null),
  goal: z.enum(['lose', 'maintain', 'gain']),
})
const machine = z.enum(['treadmill', 'elliptical', 'bike', 'stairs', 'rower', 'other'])

const Action = z.discriminatedUnion('action', [
  profileShape.extend({ action: z.literal('start'), consent: z.boolean() }),
  profileShape.extend({ action: z.literal('update') }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('steps'), date, steps: num }),
  z.object({
    action: z.literal('cardio'),
    date,
    machine,
    minutes: num,
    distanceKm: num.nullable().default(null),
    displayedKcal: num.nullable().default(null),
  }),
  z.object({ action: z.literal('cardio_photo'), date, image: z.string().min(100).max(8_000_000), mediaType: z.string() }),
  z.object({ action: z.literal('remove_cardio'), date, entryId: z.string().min(1) }),
  z.object({ action: z.literal('workout_minutes'), date, workoutLogId: z.string().min(1), minutes: num }),
])

type Out = ApiResult<EnergyState> | EnergyPhotoResult

/** Every write answers with the fresh state, so the app never has to guess what the day now says. */
export async function energyAction(ctx: TenantContext, memberId: MemberId, input: unknown): Promise<Out> {
  const parsed = Action.safeParse(input)
  if (!parsed.success) return { ok: false, error: { code: 'invalid_request' } }
  const p = parsed.data
  const d = deps()
  const mid = memberId as string
  const fresh = async (): Promise<ApiResult<EnergyState>> => ({ ok: true, value: await energyState(ctx, memberId) })

  switch (p.action) {
    case 'start': {
      const r = await startEnergyTracking(d, ctx, { ...p, memberId: mid, sex: STUDIO_MEMBER_SEX }, SOURCE)
      return r.ok ? fresh() : r
    }
    case 'update': {
      const r = await updateEnergyProfile(d, ctx, mid, p, SOURCE)
      return r.ok ? fresh() : r
    }
    case 'stop': {
      const r = await stopEnergyTracking(d, ctx, mid, SOURCE)
      return r.ok ? fresh() : r
    }
    case 'steps': {
      const r = await logEnergySteps(d, ctx, { memberId: mid, date: p.date, steps: p.steps }, SOURCE)
      return r.ok ? fresh() : r
    }
    case 'cardio': {
      const r = await logEnergyCardio(d, ctx, { ...p, memberId: mid, source: 'manual' }, SOURCE)
      return r.ok ? fresh() : r
    }
    case 'remove_cardio': {
      const r = await removeEnergyCardio(d, ctx, { memberId: mid, date: p.date, entryId: p.entryId }, SOURCE)
      return r.ok ? fresh() : r
    }
    case 'workout_minutes': {
      const r = await setEnergyWorkoutMinutes(d, ctx, { memberId: mid, date: p.date, workoutLogId: p.workoutLogId, minutes: p.minutes }, SOURCE)
      return r.ok ? fresh() : r
    }
    case 'cardio_photo': {
      if (!isCardioPhotoMedia(p.mediaType)) return { ok: false, error: { code: 'energy_photo_unreadable' } }
      // Checked BEFORE the model is called: a photo from someone who has not started would be read,
      // paid for, and then refused by the domain.
      const profile = await d.repo.getProfile(ctx, mid)
      if (!profile) return { ok: false, error: { code: 'energy_not_started' } }
      const read = await readCardioPhoto(p.image, p.mediaType)
      if (!read.ok) return { ok: false, error: { code: read.reason === 'unreadable' ? 'energy_photo_unreadable' : 'energy_photo_failed' } }
      const v = read.value
      // The screen gave calories but no time: the duration is derived, because the net-of-rest
      // subtraction needs one. The other way round — time but no calories — is the domain's own
      // estimate and needs nothing from here.
      const minutes = v.minutes ?? minutesFromDisplayedKcal({ machine: v.machine, weightKg: profile.weightKg, displayedKcal: v.kcal as number })
      const r = await logEnergyCardio(
        d,
        ctx,
        {
          memberId: mid,
          date: p.date,
          machine: v.machine,
          minutes: Math.round(minutes * 10) / 10,
          distanceKm: v.distanceKm === null ? null : Math.round(v.distanceKm * 100) / 100,
          displayedKcal: v.kcal === null ? null : Math.round(v.kcal),
          source: 'photo',
        },
        SOURCE,
      )
      // A figure outside the domain's ranges is far likelier a misread than a real session; she is
      // told the photo could not be read, and types it herself.
      if (!r.ok) return { ok: false, error: { code: r.error.code === 'energy_entry_invalid' ? 'energy_photo_unreadable' : r.error.code } }
      const added = r.value.cardio.at(-1)
      if (!added) return { ok: false, error: { code: 'energy_photo_failed' } }
      return { ok: true, value: { added: cardioWire(added), state: await energyState(ctx, memberId) } }
    }
  }
}
