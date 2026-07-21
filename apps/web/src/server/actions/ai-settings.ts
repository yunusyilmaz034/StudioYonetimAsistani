'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Ayarlar → AI Ayarları. The studio's "knowledge card": everything the AI must know to act like a
// 3–4 year veteran receptionist — persona, basics, policies, FAQ, escalation and don't-do rules. Stored
// as DATA at studios/{sid}/settings/ai and read as CONTEXT by the AI (the dashboard checklist's tone,
// and later the WhatsApp receptionist's full knowledge). Editable in the panel, never in code — a price
// or a policy the AI states is always the studio's current answer, changed here without a deploy.
const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export interface AiFaq {
  readonly q: string
  readonly a: string
}

export interface AiSettings {
  readonly tone: string // "Samimi, sıcak, sen dili; kısa ve net."
  readonly identity: string // who it is + any persona notes
  readonly basics: string // hours, address, parking, transport, women-only — free text
  readonly policies: string // trial class, cancellation, freeze, first-visit — free text (catalogue-independent)
  readonly faq: readonly AiFaq[]
  readonly escalation: string // when to hand to a human (Işıl)
  readonly neverDo: string // hard "never" rules (no price haggling, no medical advice, no promises)
  readonly examples: string // example dialogues / tone samples (optional)
}

const DEFAULT: AiSettings = { tone: '', identity: '', basics: '', policies: '', faq: [], escalation: '', neverDo: '', examples: '' }

export async function getAiSettingsAction(): Promise<AiSettings> {
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb().doc(`studios/${ctx.studioId}/settings/ai`).get()
  return { ...DEFAULT, ...((snap.data() as Partial<AiSettings> | undefined) ?? {}) }
}

const schema = z.object({
  tone: z.string().trim().max(500),
  identity: z.string().trim().max(2000),
  basics: z.string().trim().max(4000),
  policies: z.string().trim().max(4000),
  faq: z.array(z.object({ q: z.string().trim().max(300), a: z.string().trim().max(1500) })).max(60),
  escalation: z.string().trim().max(2000),
  neverDo: z.string().trim().max(2000),
  examples: z.string().trim().max(6000),
})

export async function setAiSettingsAction(input: unknown) {
  const p = schema.parse(input)
  // Drop empty FAQ rows so the model never sees a blank Q/A.
  const faq = p.faq.filter((f) => f.q.length > 0 || f.a.length > 0)
  const ctx = await requireTenantContext(OWNER)
  await adminDb().doc(`studios/${ctx.studioId}/settings/ai`).set({ ...p, faq }, { merge: true })
  return { ok: true as const }
}

// Read for server-side AI callers (checklist narrator, later the receptionist). Returns null when the
// studio hasn't filled anything in, so a caller can decide whether to add persona context at all.
export async function loadAiSettings(studioId: string): Promise<AiSettings | null> {
  const snap = await adminDb().doc(`studios/${studioId}/settings/ai`).get()
  const data = snap.data() as Partial<AiSettings> | undefined
  if (!data) return null
  return { ...DEFAULT, ...data }
}
