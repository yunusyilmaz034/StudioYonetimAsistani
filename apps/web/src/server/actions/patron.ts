'use server'

import { z } from 'zod'

import { PATRON_ACTIONS, type PatronActionKind, type PatronAnswer, type PatronBriefing, type ResolvedPatronAction } from '@/lib/patron/actions'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { askPatron, patronBriefing, patronConfigured } from '../ai/patron'
import { loadPatronSnapshot, type PatronSnapshot } from '../patron-snapshot'
import { loadAiSettings } from './ai-settings'

// AI PATRON ASISTANI web actions — OWNER-ONLY (the whole business is on this screen). The chat and the
// weekly briefing both ground on the deterministic snapshot; the AI narrates, never invents. Suggested
// actions are resolved to real, deterministic audiences here — the owner confirms each send, which then
// runs through the existing audited engagement pipeline (sendEngagementAction → notify, consent-aware).
const OWNER = ['owner', 'platform_admin'] as const

// Turn the (AI- or fallback-chosen) action kinds into concrete, owner-actionable chips: attach the real
// recipient count + member ids from the snapshot. A send-action with an empty audience is dropped.
function resolveActions(snap: PatronSnapshot, kinds: readonly PatronActionKind[]): ResolvedPatronAction[] {
  const out: ResolvedPatronAction[] = []
  for (const kind of kinds) {
    const def = PATRON_ACTIONS[kind]
    if (!def) continue
    const memberIds = def.audienceKey ? snap.audiences[def.audienceKey] : []
    if (def.audienceKey && memberIds.length === 0) continue // nothing to send → no chip
    out.push({
      kind: def.kind,
      label: def.label,
      audienceCount: memberIds.length,
      memberIds,
      defaultSubject: def.defaultSubject,
      defaultBody: def.defaultBody,
      navigate: def.navigate,
    })
  }
  return out
}

// Without AI, still be useful: surface the obviously-relevant actions from the snapshot itself.
function fallbackActions(snap: PatronSnapshot): PatronActionKind[] {
  const kinds: PatronActionKind[] = []
  if (snap.audiences.debtors.length > 0) kinds.push('remind_debtors')
  if (snap.audiences.expiring.length > 0) kinds.push('renew_expiring')
  if (snap.audiences.dormant.length > 0) kinds.push('winback_dormant')
  if (snap.operations.emptyNext7d > 0) kinds.push('draft_campaign')
  return kinds
}

export async function askPatronAction(input: unknown): Promise<PatronAnswer> {
  const p = z.object({ question: z.string().trim().min(1).max(500) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const snap = await loadPatronSnapshot(ctx)

  if (!patronConfigured()) {
    return {
      answer: 'AI asistanı henüz yapılandırılmamış (anahtar tanımlı değil). Ayarlar → AI’dan bağlanınca sorularını cevaplayabilirim. O zamana kadar aşağıdaki hızlı aksiyonları kullanabilirsin.',
      actions: resolveActions(snap, fallbackActions(snap)),
      aiGenerated: false,
    }
  }

  const settings = await loadAiSettings(ctx.studioId)
  const reply = await askPatron(p.question, snap, settings?.tone)
  if (!reply) {
    return {
      answer: 'Şu an cevap üretemedim (bağlantı sorunu olabilir). Bir daha dener misin? Bu arada aşağıdaki hızlı aksiyonları kullanabilirsin.',
      actions: resolveActions(snap, fallbackActions(snap)),
      aiGenerated: false,
    }
  }
  return { answer: reply.answer, actions: resolveActions(snap, reply.actions), aiGenerated: true }
}

const TZ = 'Europe/Istanbul'
// The Monday (studio-local) of the current week — the weekly briefing's cache key, so it regenerates at
// most once a week (cost cap), not on every dashboard open.
function weekKey(now: number): string {
  const local = new Date(new Date(now).toLocaleString('en-US', { timeZone: TZ }))
  const dow = (local.getDay() + 6) % 7 // 0 = Monday
  const monday = new Date(local.getTime() - dow * 86_400_000)
  return monday.toLocaleDateString('en-CA', { timeZone: TZ })
}

export async function patronBriefingAction(): Promise<PatronBriefing> {
  const ctx = await requireTenantContext(OWNER)
  const now = Date.now()
  const key = weekKey(now)
  const ref = adminDb().doc(`studios/${ctx.studioId}/settings/patronBriefing`)

  const snap = await loadPatronSnapshot(ctx)

  // Serve the cached briefing for this week; the actions are re-resolved against the FRESH snapshot so
  // counts never mislead mid-week.
  const cachedSnap = await ref.get()
  const cached = cachedSnap.data() as { weekKey?: string; answer?: string; actions?: PatronActionKind[]; generatedAt?: number } | undefined
  if (cached?.weekKey === key && cached.answer) {
    return {
      answer: cached.answer,
      actions: resolveActions(snap, cached.actions ?? []),
      aiGenerated: true,
      generatedAt: cached.generatedAt ?? now,
      weekKey: key,
    }
  }

  if (!patronConfigured()) {
    return { answer: '', actions: resolveActions(snap, fallbackActions(snap)), aiGenerated: false, generatedAt: now, weekKey: key }
  }

  const settings = await loadAiSettings(ctx.studioId)
  const reply = await patronBriefing(snap, settings?.tone)
  if (!reply) {
    return { answer: '', actions: resolveActions(snap, fallbackActions(snap)), aiGenerated: false, generatedAt: now, weekKey: key }
  }
  try {
    await ref.set({ weekKey: key, answer: reply.answer, actions: reply.actions, generatedAt: now }, { merge: true })
  } catch {
    /* cache write best-effort */
  }
  return { answer: reply.answer, actions: resolveActions(snap, reply.actions), aiGenerated: true, generatedAt: now, weekKey: key }
}
