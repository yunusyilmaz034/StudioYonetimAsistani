// Small, pure helpers for the energy screens. Every calorie figure is an ESTIMATE: it is shown to the
// nearest ten and always beside the word "yaklaşık" — a number shown to the last digit claims a
// precision the arithmetic does not have, and she will compare it with her watch.
import type { CardioMachine, EnergyGoal } from '@studio/core/client'

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
export function dayNote(d: { readonly steps: unknown; readonly workouts: readonly unknown[]; readonly cardio: readonly unknown[] }): string {
  const bits = [d.workouts.length > 0 ? 'Antrenman' : null, d.cardio.length > 0 ? 'Kardiyo' : null, d.steps ? 'Adım' : null].filter(Boolean)
  return bits.length > 0 ? bits.join(' + ') : 'Dinlenme'
}
