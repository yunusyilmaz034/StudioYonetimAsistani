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
  logEnergyMeal,
  logEnergySteps,
  minutesFromDisplayedKcal,
  removeEnergyCardio,
  removeEnergyMeal,
  setEnergyMealPrefs,
  updateEnergyMeal,
  setEnergyWorkoutMinutes,
  startEnergyTracking,
  stopEnergyTracking,
  systemClock,
  updateEnergyProfile,
  type CardioEntry,
  type DomainError,
  type EnergyDayView,
  type EnergyDeps,
  type EnergySex,
  type MealEntry,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import type {
  ApiResult,
  EnergyCardioWire,
  EnergyDayWire,
  EnergyMealReadResult,
  EnergyMealWire,
  EnergyPhotoResult,
  EnergyPrefill,
  EnergyState,
} from '@studio/core/client'
import { z } from 'zod'

import { domainErrorMessage } from '@/lib/domain-error'

import { readCardioPhoto, sniffCardioPhotoMedia } from './ai/cardio-photo'
import { readMealPhoto, readMealText } from './ai/meal-reader'
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

// "Rakamları gizle" is enforced HERE, not in the app: a hidden figure is never sent, so no screen —
// this release's or a careless later one — can show it by accident.
const mealWire = (m: MealEntry, hide: boolean): EnergyMealWire => ({
  id: m.id,
  slot: m.slot,
  source: m.source,
  items: m.items.map((i) => ({ name: i.name, portion: i.portion, kcalNormal: hide ? null : i.kcalNormal, kcal: hide ? null : i.kcal })),
  kcal: hide ? null : m.kcal,
  loggedAt: m.loggedAt as number,
})

const dayWire = (v: EnergyDayView, today: string, hideIntake: boolean): EnergyDayWire => ({
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
  meals: v.meals.map((m) => mealWire(m, hideIntake)),
  intakeKcal: hideIntake ? null : v.intakeKcal,
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
    profile: {
      weightKg: p.weightKg,
      heightCm: p.heightCm,
      birthYear: p.birthYear,
      bodyFatPercent: p.bodyFatPercent,
      goal: p.goal,
      mealsEnabled: p.mealsEnabled,
      hideIntake: p.hideIntake,
    },
    days: r.value.days.map((v) => dayWire(v, today, p.hideIntake)),
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
const slot = z.enum(['breakfast', 'lunch', 'dinner', 'snack'])
const mealItems = z.array(z.object({ name: z.string(), portion: z.enum(['small', 'normal', 'large']), kcalNormal: num })).max(20)
// An edit may send `null` for a line's estimate: under "Rakamları gizle" the app never had it.
const mealEditItems = z.array(z.object({ name: z.string(), portion: z.enum(['small', 'normal', 'large']), kcalNormal: num.nullable() })).max(20)

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
  // ── Meals (1.9.0). The two reads return a PROPOSAL and write nothing; `meal_add` is her tap. ──
  z.object({ action: z.literal('meal_photo'), image: z.string().min(100).max(8_000_000) }),
  z.object({ action: z.literal('meal_text'), text: z.string().trim().min(2).max(500) }),
  z.object({ action: z.literal('meal_add'), date, entryId: z.string().regex(/^mel_[A-Za-z0-9]{8,40}$/), slot, source: z.enum(['photo', 'text']), items: mealItems }),
  z.object({ action: z.literal('meal_update'), date, entryId: z.string().min(1), slot, items: mealEditItems }),
  z.object({ action: z.literal('meal_remove'), date, entryId: z.string().min(1) }),
  z.object({ action: z.literal('meal_prefs'), mealsEnabled: z.boolean(), hideIntake: z.boolean() }),
])

type Out = ApiResult<EnergyState> | EnergyPhotoResult | EnergyMealReadResult

// The app shows `message` as it stands: the sentence is written once, here on the server, beside the
// rule it explains — so a new refusal never needs an app release to be said properly.
const refuse = (error: DomainError) => ({ ok: false as const, error: { code: error.code, message: domainErrorMessage(error) } })
const PHOTO_MESSAGE = {
  energy_photo_unreadable: 'Fotoğraftan süreyi ya da kaloriyi okuyamadık. Ekranın tamamı görünecek şekilde yeniden çek ya da elle gir.',
  energy_photo_failed: 'Fotoğraf şu an okunamadı. Biraz sonra yeniden dene ya da elle gir.',
  energy_photo_format: 'Bu dosya biçimini okuyamıyoruz. Galeriden seçmek yerine ekranı doğrudan fotoğrafla ya da değerleri elle gir.',
  energy_meal_unreadable: 'Fotoğraftan yemeği seçemedik. Tabağın tamamı görünecek şekilde yeniden çek ya da ne yediğini yaz.',
  energy_meal_text_unreadable: 'Yazdığından bir yiyecek çıkaramadık. "1 kase mercimek çorbası, 2 dilim ekmek" gibi yazmayı dene.',
  energy_meal_failed: 'Şu an hesaplayamadık. Biraz sonra yeniden dene.',
  energy_meal_format: 'Bu dosya biçimini okuyamıyoruz. Tabağı doğrudan fotoğrafla ya da ne yediğini yaz.',
} as const
const photoFail = (code: keyof typeof PHOTO_MESSAGE) => ({ ok: false as const, error: { code, message: PHOTO_MESSAGE[code] } })

/** Every write answers with the fresh state, so the app never has to guess what the day now says. */
export async function energyAction(ctx: TenantContext, memberId: MemberId, input: unknown): Promise<Out> {
  const parsed = Action.safeParse(input)
  if (!parsed.success) return { ok: false, error: { code: 'invalid_request', message: 'Girdiğin bilgilerde bir sorun var. Kontrol edip yeniden dene.' } }
  const p = parsed.data
  const d = deps()
  const mid = memberId as string
  const fresh = async (): Promise<ApiResult<EnergyState>> => ({ ok: true, value: await energyState(ctx, memberId) })

  switch (p.action) {
    case 'start': {
      const r = await startEnergyTracking(d, ctx, { ...p, memberId: mid, sex: STUDIO_MEMBER_SEX }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'update': {
      const r = await updateEnergyProfile(d, ctx, mid, p, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'stop': {
      const r = await stopEnergyTracking(d, ctx, mid, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'steps': {
      const r = await logEnergySteps(d, ctx, { memberId: mid, date: p.date, steps: p.steps }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'cardio': {
      const r = await logEnergyCardio(d, ctx, { ...p, memberId: mid, source: 'manual' }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'remove_cardio': {
      const r = await removeEnergyCardio(d, ctx, { memberId: mid, date: p.date, entryId: p.entryId }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'workout_minutes': {
      const r = await setEnergyWorkoutMinutes(d, ctx, { memberId: mid, date: p.date, workoutLogId: p.workoutLogId, minutes: p.minutes }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'meal_photo':
    case 'meal_text': {
      // Checked BEFORE the model is called: a reading for someone who cannot record it is paid for
      // and thrown away.
      const profile = await d.repo.getProfile(ctx, mid)
      if (!profile) return refuse({ code: 'energy_not_started' })
      if (!profile.mealsEnabled) return refuse({ code: 'energy_meals_off' })
      let read
      if (p.action === 'meal_photo') {
        const media = sniffCardioPhotoMedia(p.image)
        if (!media) return photoFail('energy_meal_format')
        read = await readMealPhoto(p.image, media)
      } else {
        read = await readMealText(p.text)
      }
      if (!read.ok)
        return photoFail(read.reason === 'unreadable' ? (p.action === 'meal_photo' ? 'energy_meal_unreadable' : 'energy_meal_text_unreadable') : 'energy_meal_failed')
      return { ok: true, value: { items: read.items.map((i) => ({ name: i.name, kcalNormal: i.kcal })) } }
    }
    case 'meal_add': {
      const r = await logEnergyMeal(d, ctx, { memberId: mid, date: p.date, entryId: p.entryId, slot: p.slot, source: p.source, items: p.items }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'meal_update': {
      // A line sent without its estimate keeps the stored one (matched by position, then by name). A
      // NEW line must bring its own: there is nothing to keep, and nothing is invented.
      const stored = (await d.repo.getDay(ctx, mid, p.date))?.meals.find((m) => m.id === p.entryId)?.items ?? []
      const items = []
      for (const [i, it] of p.items.entries()) {
        const kept = stored[i]?.name === it.name.trim() ? stored[i] : stored.find((s) => s.name === it.name.trim())
        const kcalNormal = it.kcalNormal ?? kept?.kcalNormal
        if (kcalNormal === undefined) return refuse({ code: 'energy_entry_invalid', field: 'mealKcal' })
        items.push({ name: it.name, portion: it.portion, kcalNormal })
      }
      const r = await updateEnergyMeal(d, ctx, { memberId: mid, date: p.date, entryId: p.entryId, slot: p.slot, items }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'meal_remove': {
      const r = await removeEnergyMeal(d, ctx, { memberId: mid, date: p.date, entryId: p.entryId }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'meal_prefs': {
      const r = await setEnergyMealPrefs(d, ctx, mid, { mealsEnabled: p.mealsEnabled, hideIntake: p.hideIntake }, SOURCE)
      return r.ok ? fresh() : refuse(r.error)
    }
    case 'cardio_photo': {
      // The label the app sent is ignored; the bytes say what they are (see `sniffCardioPhotoMedia`).
      const media = sniffCardioPhotoMedia(p.image)
      if (!media) return photoFail('energy_photo_format')
      // Checked BEFORE the model is called: a photo from someone who has not started would be read,
      // paid for, and then refused by the domain.
      const profile = await d.repo.getProfile(ctx, mid)
      if (!profile) return refuse({ code: 'energy_not_started' })
      const read = await readCardioPhoto(p.image, media)
      if (!read.ok) return photoFail(read.reason === 'unreadable' ? 'energy_photo_unreadable' : 'energy_photo_failed')
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
      if (!r.ok) return r.error.code === 'energy_entry_invalid' ? photoFail('energy_photo_unreadable') : refuse(r.error)
      const added = r.value.cardio.at(-1)
      if (!added) return photoFail('energy_photo_failed')
      return { ok: true, value: { added: cardioWire(added), state: await energyState(ctx, memberId) } }
    }
  }
}
