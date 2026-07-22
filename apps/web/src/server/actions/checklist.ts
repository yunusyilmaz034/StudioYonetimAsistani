'use server'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { narrateChecklist, type DailyChecklist } from '../ai/anthropic'
import { loadAiSettings } from './ai-settings'
import type { AdvisorItem } from '../advisor-query'

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
