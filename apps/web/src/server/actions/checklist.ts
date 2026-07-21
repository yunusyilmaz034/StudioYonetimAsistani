'use server'

import { requireTenantContext } from '../auth'
import { narrateChecklist, type DailyChecklist } from '../ai/anthropic'
import { loadAiSettings } from './ai-settings'
import type { AdvisorItem } from '../advisor-query'

// The dashboard (owner + reception) asks the AI to turn today's deterministic advisor items into a warm,
// prioritised checklist. Returns null when the AI key isn't configured or the call fails — the client
// then keeps showing the deterministic list. The items are the studio's OWN signals, passed from the
// server-rendered dashboard; the narrator tokenises names out before any model call.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export async function narrateChecklistAction(items: readonly AdvisorItem[]): Promise<DailyChecklist | null> {
  const ctx = await requireTenantContext(OPS)
  const ai = await loadAiSettings(ctx.studioId) // the studio's tone, set in Ayarlar → AI
  return narrateChecklist(items, 'stüdyonuz', ai?.tone)
}
