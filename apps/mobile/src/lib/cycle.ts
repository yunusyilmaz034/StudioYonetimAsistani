// DÖNGÜ MODU — the phone's own store. Nothing here is ever sent anywhere (Faz 3.2).
//
// The roadmap's binding rule for the women's-health module: *"Üyenin bedenine ait veri telefonunda
// kalır. Stüdyoya ait veri sunucuda kalır."* So this file is the whole persistence layer: there is no
// endpoint, no Firestore document, no sync, and no telemetry counting how many members turned it on.
// If the panel could count it, the panel could be asked to list it.
//
// That choice is also the KVKK answer. Cycle data is special-category health data; the safest way to
// hold it is not to. The studio cannot read it, our backups do not contain it, and a database leak
// would not include it — because it is not in the database.
//
// HONEST LIMIT, stated to her in the UI rather than buried here: this lives in the app's own storage.
// Delete the app and it is gone; the phone's own backup may carry it to her next phone. Encrypted
// export is not in v1.
import AsyncStorage from '@react-native-async-storage/async-storage'

import type { CyclePhase, FeelEntry, SessionFeel } from '@studio/core/client'

const KEY = 'cycle.v1'

/**
 * Plain Turkish for the four phases — deliberately the words she would use, not the clinical ones.
 *
 * Lives here rather than on a screen because two screens say it (the home line and the cycle screen)
 * and a phase named two different ways in one app reads as two different things.
 */
export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'Regl günleri',
  follicular: 'Regl sonrası',
  ovulatory: 'Yumurtlama dönemi',
  luteal: 'Regl öncesi',
}

export interface CycleStore {
  /** Explicit, separate consent. The feature does not exist in the UI until this is true. */
  readonly consent: boolean
  /** LocalDate ('YYYY-MM-DD') of each logged first day of bleeding. */
  readonly starts: readonly string[]
  /** One tap per class: how it felt. */
  readonly feels: readonly FeelEntry[]
}

export const EMPTY: CycleStore = { consent: false, starts: [], feels: [] }

/**
 * TODAY IN HER OWN TIMEZONE, not the studio's.
 *
 * `toISOString()` is UTC: at 02:00 in Istanbul it returns yesterday, so a period logged that night
 * would be recorded a day early and every prediction after it would drift. `en-CA` is the locale
 * that formats as `YYYY-MM-DD`, which is what the pure functions parse.
 */
export function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function dateOf(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-CA')
}

export async function loadCycle(): Promise<CycleStore> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<CycleStore>
    // Read defensively: a half-written or older record must degrade to "no data", never crash the
    // screen she opened to log something.
    return {
      consent: parsed.consent === true,
      starts: Array.isArray(parsed.starts) ? parsed.starts.filter((s): s is string => typeof s === 'string') : [],
      feels: Array.isArray(parsed.feels) ? parsed.feels.filter((f): f is FeelEntry => typeof f?.date === 'string') : [],
    }
  } catch {
    return EMPTY
  }
}

async function save(next: CycleStore): Promise<CycleStore> {
  await AsyncStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export async function setConsent(current: CycleStore, consent: boolean): Promise<CycleStore> {
  return save({ ...current, consent })
}

/** Newest first — the order the history list wants. */
export function sortedStarts(store: CycleStore): readonly string[] {
  return [...store.starts].sort((a, b) => b.localeCompare(a))
}

export async function addStart(current: CycleStore, date: string): Promise<CycleStore> {
  if (current.starts.includes(date)) return current
  return save({ ...current, starts: [...current.starts, date] })
}

export async function removeStart(current: CycleStore, date: string): Promise<CycleStore> {
  return save({ ...current, starts: current.starts.filter((d) => d !== date) })
}

/** One rating per day; tapping again replaces it rather than stacking a second opinion. */
export async function setFeel(current: CycleStore, date: string, feel: SessionFeel): Promise<CycleStore> {
  return save({ ...current, feels: [...current.feels.filter((f) => f.date !== date), { date, feel }] })
}

/**
 * Delete everything, for real.
 *
 * `removeItem` rather than writing an empty record: "sil" must leave nothing behind, including the
 * shape of what was there. Consent goes with it — turning the feature back on asks again.
 */
export async function wipeCycle(): Promise<CycleStore> {
  await AsyncStorage.removeItem(KEY)
  return EMPTY
}
