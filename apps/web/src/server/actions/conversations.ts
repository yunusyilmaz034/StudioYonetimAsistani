'use server'

import { sendWhatsAppText, type MetaWhatsAppConfig } from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// The reception/operator side of the WhatsApp AI receptionist. The conversations collection is
// server-only (buyer PII), so the panel reaches it ONLY through these actions (Admin SDK). Reception
// can watch what the AI is saying, take a conversation over from the AI, reply, and hand it back.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const MAX_HISTORY = 40
const nonEmpty = z.string().trim().min(1)

export interface ConvMsg {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly at: number
}
export type Temp = 'sıcak' | 'ılık' | 'soğuk'
export interface ConvSummary {
  readonly phone: string
  readonly name: string
  readonly status: 'ai' | 'human'
  readonly needsAttention: boolean
  readonly lastAt: number
  readonly lastText: string
  readonly temp: Temp | null // AI's read of conversion likelihood
  readonly reason: string // one-line why (AI estimate — an aid, not truth)
}
export interface ConvDetail extends ConvSummary {
  readonly messages: readonly ConvMsg[]
}

function summarize(c: Record<string, unknown>): ConvSummary {
  const msgs = (c.messages as ConvMsg[] | undefined) ?? []
  const last = msgs[msgs.length - 1]
  const temp = c.temp === 'sıcak' || c.temp === 'ılık' || c.temp === 'soğuk' ? (c.temp as Temp) : null
  return {
    phone: String(c.phone ?? ''),
    name: String(c.name ?? ''),
    status: (c.status as 'ai' | 'human') ?? 'ai',
    needsAttention: Boolean(c.needsAttention),
    lastAt: Number(c.lastAt ?? 0),
    lastText: (last?.text ?? '').slice(0, 140),
    temp,
    reason: String(c.reason ?? ''),
  }
}

// The whole list (newest first) — feeds the "Tüm Sohbetler" screen AND the floating dock's poll.
export async function listConversationsAction(): Promise<readonly ConvSummary[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb().collection(`studios/${ctx.studioId}/conversations`).orderBy('lastAt', 'desc').limit(100).get()
  return snap.docs.map((d) => summarize(d.data()))
}

export async function getConversationAction(input: unknown): Promise<ConvDetail | null> {
  const p = z.object({ phone: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb().doc(`studios/${ctx.studioId}/conversations/${p.phone}`).get()
  if (!snap.exists) return null
  const c = snap.data() as Record<string, unknown>
  return { ...summarize(c), messages: (c.messages as ConvMsg[] | undefined) ?? [] }
}

// Reception sends a reply (free-form, valid inside WhatsApp's 24h window). This also TAKES OVER the
// conversation: status → 'human', so the AI stops auto-replying until it is handed back.
export async function replyConversationAction(input: unknown) {
  const p = z.object({ phone: nonEmpty, text: z.string().trim().min(1).max(4000) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return { ok: false as const, error: { code: 'whatsapp_not_configured' as const } }

  const config: MetaWhatsAppConfig = { phoneNumberId: phoneId, accessToken: token }
  const sent = await sendWhatsAppText(config, p.phone, p.text)
  if (!sent.ok) return { ok: false as const, error: { code: 'send_failed' as const }, detail: sent.code }

  const ref = adminDb().doc(`studios/${ctx.studioId}/conversations/${p.phone}`)
  const now = Date.now()
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const c = (snap.data() as Record<string, unknown> | undefined) ?? {}
    const msgs = ((c.messages as ConvMsg[] | undefined) ?? []).concat({ role: 'assistant', text: p.text, at: now }).slice(-MAX_HISTORY)
    tx.set(ref, { status: 'human', needsAttention: false, lastAt: now, messages: msgs }, { merge: true })
  })
  return { ok: true as const }
}

// Take over from the AI ('human') or hand back ('ai'); either way the attention flag is cleared.
export async function setConversationStatusAction(input: unknown) {
  const p = z.object({ phone: nonEmpty, status: z.enum(['ai', 'human']) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  await adminDb().doc(`studios/${ctx.studioId}/conversations/${p.phone}`).set({ status: p.status, needsAttention: false }, { merge: true })
  return { ok: true as const }
}

// Reception has seen it — clear the "needs attention" flag without changing who's handling it.
export async function markConversationSeenAction(input: unknown) {
  const p = z.object({ phone: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  await adminDb().doc(`studios/${ctx.studioId}/conversations/${p.phone}`).set({ needsAttention: false }, { merge: true })
  return { ok: true as const }
}
