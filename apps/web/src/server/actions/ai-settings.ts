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
  // The CURRENT campaign, in the owner's own words: what is being pushed, what the poster promises,
  // what to say about instalments. Deliberately free text and deliberately separate from `policies` —
  // a campaign ends, and the owner must be able to empty one field without re-reading the rest. Prices
  // themselves still come from the live catalogue; this says what to DO with them.
  readonly campaign: string
  // FİYAT LİSTESİ (owner, 2026-10-23): the ONE price the assistant quotes, in the studio's own words.
  // When filled, it REPLACES the catalogue as the assistant's price source — a customer is never told a
  // cash/card split (*"kk farkı suç"*). Empty ⇒ the catalogue, as before. Data, never a literal (AD-41).
  readonly priceList: string
  readonly faq: readonly AiFaq[]
  readonly escalation: string // when to hand to a human (Işıl)
  readonly neverDo: string // hard "never" rules (no price haggling, no medical advice, no promises)
  readonly examples: string // example dialogues / tone samples (optional)
  // The MASTER switch for the WhatsApp AI receptionist. Default OFF: the webhook still captures the
  // conversation, but the AI only auto-replies once the owner deliberately turns it on.
  readonly whatsappActive: boolean
  // IG-1 (2026-11-03): Instagram DM. 'off' = stored + desk flagged · 'draft' = the AI prepares, a human
  // sends · 'auto' = the AI sends. Default OFF, like WhatsApp: turning a customer channel on is a
  // decision, never a default.
  readonly instagramMode: InstagramMode
}
export type InstagramMode = 'off' | 'draft' | 'auto'

const DEFAULT: AiSettings = { tone: '', identity: '', basics: '', policies: '', campaign: '', priceList: '', faq: [], escalation: '', neverDo: '', examples: '', whatsappActive: false, instagramMode: 'off' }

export async function getAiSettingsAction(): Promise<AiSettings> {
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb().doc(`studios/${ctx.studioId}/settings/ai`).get()
  return { ...DEFAULT, ...((snap.data() as Partial<AiSettings> | undefined) ?? {}) }
}

// LIMITS (2026-11-03). The knowledge card the studio actually runs on is far longer than the first
// limits assumed (measured: tone 2.660, basics 7.813, policies 8.012 characters) — it was grown by
// scripts and by hand, and the form then refused EVERY save with a bare "Kaydedilemedi", for every
// field, because three were over. A limit here guards against a runaway paste, not against a real
// card: they sit well above today's card, and the receptionist's prompt is cached, so length is not a
// cost problem at this size.
const TEXT = (max: number) => z.string().trim().max(max)
const schema = z.object({
  tone: TEXT(6000),
  identity: TEXT(6000),
  basics: TEXT(30000),
  policies: TEXT(30000),
  campaign: TEXT(20000).default(''),
  priceList: TEXT(20000).default(''),
  faq: z.array(z.object({ q: TEXT(1000), a: TEXT(6000) })).max(120),
  escalation: TEXT(10000),
  neverDo: TEXT(10000),
  examples: TEXT(20000),
  whatsappActive: z.boolean().default(false),
  instagramMode: z.enum(['off', 'draft', 'auto']).default('off'),
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
