'use server'

import { FieldValue } from 'firebase-admin/firestore'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { narrateChecklist, type DailyChecklist } from '../ai/anthropic'
import { loadAiSettings } from './ai-settings'
import type { AdvisorItem } from '../advisor-query'
import { applyChecklistCooldown, type TickedItem } from '../checklist-snooze'

// The dashboard (owner + reception) asks the AI to turn today's deterministic advisor items into a warm,
// prioritised checklist. Returns null when the AI key isn't configured or the call fails — the client
// then keeps showing the deterministic list. The items are the studio's OWN signals, passed from the
// server-rendered dashboard; the narrator tokenises names out before any model call.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

// The AI narration is regenerated at fixed studio times only (owner: 10:00, 14:00, 19:00 TRT — three
// times a day is enough) — NOT on every dashboard open — so cost is capped at ~3 calls/day. Within a
// slot the cached narration is served; the client keeps the underlying list fresh (drops resolved
// items, appends new ones) so mid-slot staleness never misleads the desk.
const SLOTS = [10, 14, 19]
function currentSlotKey(nowMs: number): string {
  const trt = new Date(nowMs + 3 * 3_600_000) // TRT = UTC+3, no DST
  const hour = trt.getUTCHours()
  let slot: number | null = null
  for (const s of SLOTS) if (hour >= s) slot = s
  if (slot === null) {
    // Before the first slot of the day → carry the previous day's last slot.
    const prev = new Date(nowMs + 3 * 3_600_000 - 86_400_000)
    return `${prev.toISOString().slice(0, 10)}:19`
  }
  return `${trt.toISOString().slice(0, 10)}:${slot}`
}

export async function narrateChecklistAction(items: readonly AdvisorItem[]): Promise<DailyChecklist | null> {
  const ctx = await requireTenantContext(OPS)
  if (items.length === 0) return null

  const slot = currentSlotKey(Date.now())
  const ref = adminDb().doc(`studios/${ctx.studioId}/settings/aiChecklist`)
  const snap = await ref.get()
  const cached = snap.data() as { slot?: string; checklist?: DailyChecklist } | undefined
  if (cached?.slot === slot && cached.checklist) return cached.checklist // same slot → no new AI call

  const ai = await loadAiSettings(ctx.studioId) // the studio's tone, set in Ayarlar → AI
  const result = await narrateChecklist(items, 'stüdyonuz', ai?.tone)
  if (result) {
    try {
      await ref.set({ slot, checklist: result, at: Date.now() }, { merge: true })
    } catch {
      /* cache write is best-effort — a failure just means we regenerate next load */
    }
  }
  return result
}

// ── KİM HANGİ İŞİ KAPATTI (owner, 2026-08-05) ───────────────────────────────────────────────
//
// The ticks used to live in `localStorage`, which made them a private note on one machine:
// reception ticked at the desk and the owner's phone showed nothing done. *"Kim ne iş kapattı,
// bunların bilgisi tutulsun."* So they move to the studio, with a name and a time on each one.
//
// ONE DOCUMENT PER DAY (`checklistDone/{yyyy-mm-dd}`), a map of itemId → who/when. One read to
// open the dashboard, one write per tick, no index, and un-ticking simply removes the key.
//
// **This is NOT an event.** Ticking a checklist line is a working note, not something that happened
// to the business — no credit moves, no state changes, nothing downstream reads it. Putting it in
// the append-only log would dilute the one place that is supposed to mean "this occurred". It is
// kept deliberately outside, and it is disposable: losing it costs a day's tick marks, nothing more.
export interface ChecklistDoneEntry {
  readonly itemId: string
  readonly byName: string
  readonly at: number
}

const doneDoc = (studioId: string, dayKey: string) =>
  adminDb().collection('studios').doc(studioId).collection('checklistDone').doc(dayKey)

export async function getChecklistDoneAction(dayKey: string): Promise<readonly ChecklistDoneEntry[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await doneDoc(ctx.studioId as string, dayKey).get()
  const map = (snap.data()?.items ?? {}) as Record<string, { byName?: string; at?: number }>
  return Object.entries(map).map(([itemId, v]) => ({
    itemId,
    byName: v.byName ?? '—',
    at: Number(v.at ?? 0),
  }))
}

export async function setChecklistDoneAction(input: {
  dayKey: string
  /** Tiklenen işler. `kind` soğuma için gerekli: bir telefon görüşmesi ertesi gün geri gelmez. */
  items: readonly TickedItem[]
  done: boolean
}): Promise<readonly ChecklistDoneEntry[]> {
  const ctx = await requireTenantContext(OPS)
  const ref = doneDoc(ctx.studioId as string, input.dayKey)
  // The desk's own name, so the row can say WHO closed it. The session claims carry no name, so the
  // staff record is read — one extra read on an action that fires a handful of times a day. A tick
  // with no name is still better than a tick with a wrong one, hence the id fallback.
  const uid = ctx.actor.id as string
  const staff = await adminDb().collection('studios').doc(ctx.studioId as string).collection('staff').doc(uid).get()
  const byName = (staff.data()?.displayName as string | undefined)?.trim() || uid
  const now = Date.now()

  // A merge write: two people ticking different lines at the same moment must not overwrite each
  // other, which a whole-document set would do.
  const patch: Record<string, unknown> = {}
  for (const it of input.items) {
    patch[`items.${it.id}`] = input.done ? { byName, at: now } : FieldValue.delete()
  }
  await ref.set({}, { merge: true })
  await ref.update(patch)

  // Bazı işler bugüne değil, yapılan bir telefon görüşmesine aittir; onlar bir süre listeden çıkar.
  // Başarısız olursa tik yine de durur — soğuma bir kolaylık, tikin kendisi kayıt.
  try {
    await applyChecklistCooldown(ctx.studioId as string, input.items, input.done, byName, now)
  } catch {
    /* best-effort: the item simply comes back tomorrow, which is the old behaviour */
  }

  return getChecklistDoneAction(input.dayKey)
}
