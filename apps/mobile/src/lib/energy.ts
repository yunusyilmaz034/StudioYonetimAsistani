// Small, pure helpers for the energy screens. Every calorie figure is an ESTIMATE: it is shown to the
// nearest ten and always beside the word "yaklaşık" — a number shown to the last digit claims a
// precision the arithmetic does not have, and she will compare it with her watch.
import { MEAL_PORTION_FACTOR, type CardioMachine, type EnergyGoal, type MealPortion, type MealSlot } from '@studio/core/client'

export const kcal10 = (n: number): number => Math.round(n / 10) * 10
export const trNum = (n: number): string => n.toLocaleString('tr-TR')
export const kcalText = (n: number): string => trNum(kcal10(n))

/** "64,5" → 64.5. Empty or not a number ⇒ `null`; the server names the field if it is out of range. */
export function parseNum(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export const MACHINE_LABEL: Record<CardioMachine, string> = {
  treadmill: 'Koşu bandı',
  elliptical: 'Eliptik',
  bike: 'Bisiklet',
  stairs: 'Merdiven',
  rower: 'Kürek',
  other: 'Diğer',
}
export const MACHINES = Object.keys(MACHINE_LABEL) as CardioMachine[]

export const GOALS: readonly { key: EnergyGoal; title: string; body: string }[] = [
  { key: 'lose', title: 'Kilo vermek', body: 'Yaktığından biraz az al' },
  { key: 'maintain', title: 'Kilomu korumak', body: 'Yaktığın kadar al' },
  { key: 'gain', title: 'Kas kazanmak', body: 'Yaktığından biraz fazla al, proteini artır' },
]

const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  // Noon UTC: the weekday of a calendar DATE, with no time zone able to push it across midnight.
  return { m, d, dow: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() }
}
/** "Sal 13 Eki" */
export function dayLabel(iso: string): string {
  const { m, d, dow } = parts(iso)
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}`
}
/** "Sal" */
export const weekdayShort = (iso: string): string => DAYS[parts(iso).dow] as string

/** One line describing what she did that day — the history row's caption. */
export function dayNote(d: { readonly steps: unknown; readonly workouts: readonly unknown[]; readonly cardio: readonly unknown[]; readonly meals?: readonly unknown[] }): string {
  const bits = [d.workouts.length > 0 ? 'Antrenman' : null, d.cardio.length > 0 ? 'Kardiyo' : null, d.steps ? 'Adım' : null, (d.meals?.length ?? 0) > 0 ? 'Öğün' : null].filter(Boolean)
  return bits.length > 0 ? bits.join(' + ') : 'Dinlenme'
}

// ── Meals (1.9.0) ─────────────────────────────────────────────────────────────────────────────
export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara' }
export const SLOTS = Object.keys(SLOT_LABEL) as MealSlot[]
export const PORTION_LABEL: Record<MealPortion, string> = { small: 'Az', normal: 'Normal', large: 'Çok' }
export const PORTIONS = Object.keys(PORTION_LABEL) as MealPortion[]

/** The slot a meal most likely is, from the hour she records it — preselected, one tap to change. */
export function slotForHour(hour: number): MealSlot {
  if (hour >= 5 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 22) return 'dinner'
  return 'snack'
}

/** A preview only: the server prices with the same factors and its figure is the one that is kept. */
export const mealLineKcal = (kcalNormal: number, portion: MealPortion): number => Math.round(kcalNormal * MEAL_PORTION_FACTOR[portion])

/** Client-minted, so a retried "Kaydet" cannot record the same plate twice. */
export function newMealId(): string {
  const abc = 'ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 20; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return `mel_${s}`
}

/** "08:40" from an instant, studio time. */
export const clockTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
