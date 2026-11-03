// The PURE half of the Instagram DM webhook (IG-1). Everything here is a function of its input —
// no Firestore, no clock, no network — so the rules that decide what a webhook body MEANS are tested
// in milliseconds, next to the code (vitest picks up apps/functions/src/**/*.test.ts).
//
// What Meta sends (Messenger Platform for Instagram, `object: "instagram"`):
//   { object: 'instagram', entry: [{ id: <our IG account id>, time, messaging: [{
//       sender: { id }, recipient: { id }, timestamp,
//       message: { mid, text?, attachments?, is_echo?, is_deleted?, is_unsupported? } }] }] }
//
// An ECHO is a message OUR account sent. Two very different things produce one:
//   · the panel sent it through the API      → we already wrote it; its `mid` is in `seenIds`
//   · Işıl answered from the Instagram app   → a human has taken the conversation
// The parser only says "this is an echo to <customer>"; telling the two apart needs the stored
// conversation, so it is the webhook's job.
import { createHmac, timingSafeEqual } from 'node:crypto'

import { normalizePhone } from '@studio/core'

import { instagramAdId } from './ad-referral'

export type InstagramInbound =
  | {
      readonly kind: 'message'
      readonly igsid: string // the CUSTOMER
      readonly mid: string
      readonly text: string | null
      readonly hasAttachment: boolean
      readonly at: number // ms, Meta's timestamp
      readonly adId: string | null // IG-4a — the click-to-message ad that opened it, if any
    }
  | {
      readonly kind: 'echo'
      readonly igsid: string // the CUSTOMER it was sent to
      readonly mid: string
      readonly text: string | null
      readonly at: number
    }

interface RawMessaging {
  referral?: unknown
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    attachments?: unknown[]
    is_echo?: boolean
    is_deleted?: boolean
    is_unsupported?: boolean
  }
}

export function parseInstagramWebhook(body: unknown): InstagramInbound[] {
  const b = body as { object?: string; entry?: { messaging?: RawMessaging[] }[] } | null
  if (!b || b.object !== 'instagram' || !Array.isArray(b.entry)) return []
  const out: InstagramInbound[] = []
  for (const entry of b.entry) {
    for (const m of entry.messaging ?? []) {
      const msg = m.message
      if (!msg?.mid || msg.is_deleted) continue // reactions, reads, deletions: nothing to answer
      const at = typeof m.timestamp === 'number' ? m.timestamp : 0
      const text = typeof msg.text === 'string' && msg.text.trim() !== '' ? msg.text : null
      if (msg.is_echo) {
        const igsid = m.recipient?.id
        if (igsid) out.push({ kind: 'echo', igsid, mid: msg.mid, text, at })
        continue
      }
      const igsid = m.sender?.id
      if (!igsid) continue
      const hasAttachment = (Array.isArray(msg.attachments) && msg.attachments.length > 0) || Boolean(msg.is_unsupported)
      if (!text && !hasAttachment) continue
      out.push({ kind: 'message', igsid, mid: msg.mid, text, hasAttachment, at, adId: instagramAdId(m) })
    }
  }
  return out
}

/**
 * Meta signs every POST with the app secret: `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>`.
 * Without this check anyone who learns the URL can invent customers, open leads and spend AI money.
 * Constant-time comparison; a missing or malformed header is a refusal, never a pass.
 */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false
  const given = Buffer.from(header.slice('sha256='.length), 'hex')
  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// A Turkish mobile number written anywhere in a sentence: "0532 123 45 67", "+90 (532) 1234567",
// "5321234567". Candidates are runs of digits with the usual separators; each is run through the
// SAME normaliser the member import uses (AD-40), so a number we would reject there is not accepted
// here either. The FIRST valid one wins.
const CANDIDATE = /(?:\+?\s*9\s*0[\s.-]*)?\(?0?\s*5\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g

/** The phone she wrote, as the digits-only uniqueness key (`905321234567`) — or null. */
export function extractPhone(text: string | null): string | null {
  if (!text) return null
  for (const m of text.matchAll(CANDIDATE)) {
    const r = normalizePhone(m[0])
    if (r.ok) return r.value.normalized
  }
  return null
}

/** The line shown in the inbox and to the model for a message we cannot read. */
export const ATTACHMENT_PLACEHOLDER = '[fotoğraf / ek — okunamadı]'

/**
 * What the webhook may do with a new customer message — the ONE place the mode is interpreted, so the
 * owner's guarantee is a tested rule rather than an `if` buried in I/O:
 *   'store' — nobody answers automatically; the desk is flagged
 *   'draft' — the AI prepares a reply; a human sends it (the panel's Gönder)
 *   'send'  — the AI sends it (auto mode)
 * DRAFT MODE NEVER SENDS. Auto mode without Meta credentials degrades to a draft, never to silence.
 */
export function instagramAction(input: {
  readonly mode: 'off' | 'draft' | 'auto' | undefined
  readonly humanHolds: boolean
  readonly aiReady: boolean // knowledge card + Anthropic key present
  readonly readable: boolean // the message has text the model can read
  readonly canSend: boolean // Meta credentials present
}): 'store' | 'draft' | 'send' {
  const mode = input.mode ?? 'off'
  if (mode === 'off' || input.humanHolds || !input.aiReady || !input.readable) return 'store'
  if (mode === 'auto' && input.canSend) return 'send'
  return 'draft'
}
