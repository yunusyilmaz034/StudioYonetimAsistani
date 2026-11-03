// The Instagram DM AI receptionist — inbound webhook (IG-1, 2026-11-03).
//
// Same receptionist as WhatsApp (same knowledge card, same live prices, same single-price rule —
// OR-129), reached through a different door. The pieces are IMPORTED from whatsapp-webhook.ts, not
// copied: two receptionists with two prompts is how the two channels would start quoting two prices.
//
// What is different from WhatsApp, and why:
//
//   · THE KEY. A WhatsApp conversation is keyed by the phone; Instagram gives us no phone, only an
//     Instagram-scoped id (IGSID). The conversation lives in the SAME collection (one inbox for the
//     desk) under `ig_<igsid>`, with `channel: 'instagram'`. A document without `channel` is WhatsApp —
//     so no historical document changes.
//
//   · THE LEAD WAITS FOR A PHONE (owner, 2026-11-03: "telefonu alınca girsin"). WhatsApp opens a lead on
//     first contact because the phone IS the identity. Here the lead opens only when she writes a phone
//     number — and not if that number is a member's, and not if a lead with that number already exists
//     (she may have written on WhatsApp too: one person, one lead, one count).
//
//   · THE MODE. `settings/ai.instagramMode`: 'off' (store + flag the desk), 'draft' (the AI prepares a
//     reply and a HUMAN sends it — the panel's Gönder), 'auto' (sends, like WhatsApp). Absent = off.
//     In draft mode NOTHING in this file can send: the only send path is the `auto` branch.
//
//   · ECHOES. Every message our account sends comes back as an echo. If its `mid` is one we recorded
//     when sending (panel or auto), it is ours and ignored. Otherwise somebody answered from the
//     Instagram app itself — a human took the conversation, so the AI stands down.
//
//   · THE SIGNATURE. Every POST must carry Meta's HMAC (`X-Hub-Signature-256`) over the raw body. No
//     secret configured, or a bad signature → 401, nothing stored.
//
// PII (handle, messages, phone) lives on the conversation document (server-only), never in an event.
// The only event this file can write is the existing `lead.captured` / stage move — no schema change.
import {
  decideCaptureLead,
  FirestoreCrmRepository,
  instagramUsername,
  instant,
  newCorrelationId,
  sendInstagramText,
  type Lead,
  type MetaInstagramConfig,
  type TenantContext,
} from '@studio/core'
import * as logger from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'

import { db } from '../shared/firebase'
import { INSTAGRAM_RECEPTIONIST_SECRETS, REGION } from '../shared/region'
import { ATTACHMENT_PLACEHOLDER, extractPhone, instagramAction, parseInstagramWebhook, verifyMetaSignature } from './instagram-parse'
import {
  aiReply,
  buildSystem,
  huniyiIlerlet,
  liveFacts,
  MAX_HISTORY,
  tellTheDesk,
  whoBlock,
  whoIsWriting,
  type AiSettingsDoc,
  type Conversation,
  type Role,
} from './whatsapp-webhook'

const SOURCE = 'instagram_ai'

export interface InstagramConversation extends Conversation {
  channel: 'instagram'
  igsid: string
  handle?: string
  // Her last message — the 24-hour reply window is measured from here, not from `lastAt` (which our
  // own replies move too).
  lastUserAt?: number
  // The AI's prepared reply in draft mode. Cleared by any reply (panel, Instagram app) or a hand-over.
  draft?: { text: string; at: number } | null
}

const keyOf = (igsid: string) => `ig_${igsid}`

function ctxOf(sid: string): TenantContext {
  return { studioId: sid as never, branchIds: [], role: 'owner', actor: { type: 'system', id: 'instagram_webhook' } as TenantContext['actor'] }
}

function igConfig(): MetaInstagramConfig | null {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
  const pageId = process.env.INSTAGRAM_PAGE_ID
  if (!accessToken || !pageId) return null
  return { accessToken, pageId, ...(process.env.INSTAGRAM_API_VERSION ? { apiVersion: process.env.INSTAGRAM_API_VERSION } : {}) }
}

// The receptionist's prompt was written for WhatsApp, and two things in it are wrong on Instagram: it
// may assume we know her number, and the closing "here is our phone line" is still right but we also
// need HERS for the desk to call. One uncached block, after the cache breakpoint (see aiReply).
function channelBlock(phoneKnown: boolean): string {
  return `— KANAL: INSTAGRAM DM —
Bu sohbet WhatsApp değil, stüdyonun Instagram hesabına gelen bir DİREKT MESAJ.
${phoneKnown
    ? '- Müşterinin telefon numarasını biliyoruz; tekrar isteme.'
    : '- Müşterinin telefon numarasını BİLMİYORUZ. Fiyatı ya da istediği bilgiyi verdikten sonra, uygun bir anda BİR KEZ kibarca telefonunu rica et ("ekibimiz size dönebilsin diye numaranızı bırakır mısınız?"). Vermezse ısrar etme, bir daha sorma.'}
- Instagram'da uzun mesaj daha da az okunur: cevabı kısa tut.`
}

async function capturePhoneLead(sid: string, conv: InstagramConversation, phone: string): Promise<'member' | 'existing' | 'created' | 'failed'> {
  const database = db()
  const ctx = ctxOf(sid)
  try {
    if (await whoIsWriting(database, ctx, phone)) return 'member'
    const repo = new FirestoreCrmRepository(database)
    if ((await repo.listLeads(ctx)).some((l) => l.phone === phone)) return 'existing'
    const correlationId = newCorrelationId()
    const now = instant(Date.now())
    const lead: Lead = {
      id: `led_${correlationId.slice(4)}`,
      studioId: ctx.studioId,
      branchId: null,
      fullName: conv.name || (conv.handle ? `@${conv.handle}` : `Instagram ${phone.slice(-4)}`),
      phone,
      email: null,
      source: 'instagram',
      sourceDetail: 'Instagram DM',
      stage: 'new',
      ownerStaffId: null,
      createdAt: now,
      createdBy: ctx.actor,
      lostReason: null,
      lostNote: null,
      convertedMemberId: null,
      closedAt: null,
      note: null,
    }
    const decided = decideCaptureLead({ studioId: ctx.studioId, actor: ctx.actor, now, correlationId, source: SOURCE }, lead)
    if (!decided.ok) return 'failed'
    await repo.saveLead(ctx, decided.value.next, decided.value.events)
    return 'created'
  } catch (e) {
    logger.warn('[ig-webhook] lead capture failed', (e as Error)?.message)
    return 'failed'
  }
}

async function processEcho(sid: string, igsid: string, mid: string, text: string | null, at: number): Promise<void> {
  const ref = db().doc(`studios/${sid}/conversations/${keyOf(igsid)}`)
  const snap = await ref.get()
  if (!snap.exists) return // an echo for a conversation we never saw: nothing to update
  const conv = snap.data() as InstagramConversation
  if (conv.seenIds.includes(mid)) return // ours — sent by the panel or by auto mode
  // Somebody answered from the Instagram app. A human holds the conversation now.
  conv.messages = [...conv.messages, { role: 'assistant' as Role, text: text ?? ATTACHMENT_PLACEHOLDER, at: at || Date.now() }].slice(-MAX_HISTORY)
  conv.seenIds = [...conv.seenIds, mid].slice(-30)
  conv.status = 'human'
  conv.needsAttention = false
  conv.draft = null
  conv.lastAt = Math.max(conv.lastAt, at || Date.now())
  await ref.set(conv, { merge: true })
}

async function processMessage(sid: string, igsid: string, mid: string, text: string | null, hasAttachment: boolean, at: number, adId: string | null = null): Promise<void> {
  const database = db()
  const ctx = ctxOf(sid)
  const ref = database.doc(`studios/${sid}/conversations/${keyOf(igsid)}`)
  const snap = await ref.get()
  const now = Date.now()
  const conv: InstagramConversation = (snap.data() as InstagramConversation | undefined) ?? {
    channel: 'instagram',
    igsid,
    phone: '',
    name: '',
    status: 'ai',
    needsAttention: false,
    lastAt: 0,
    firstAt: now,
    seenIds: [],
    messages: [],
  }
  if (conv.seenIds.includes(mid)) return // Meta retries the same mid
  // IG-4a: the first ad referral is kept; a later one never re-attributes her.
  if (adId && !conv.adRef) conv.adRef = { adId, at: at || Date.now(), channel: 'instagram' }

  const config = igConfig()
  // Who she is, once. Meta may not grant profile access yet — then she stays "Instagram ·…1234".
  if (!conv.handle && config) {
    const who = await instagramUsername(config, igsid)
    if (who) {
      conv.handle = who.username
      if (!conv.name && who.name) conv.name = who.name
    }
  }

  // THE PHONE, and with it the lead (owner rule). Only the first phone counts; a later "my sister's
  // number is…" does not re-key the person.
  if (!conv.phone) {
    const phone = extractPhone(text)
    if (phone) {
      const outcome = await capturePhoneLead(sid, conv, phone)
      if (outcome !== 'failed') conv.phone = phone
      logger.info('[ig-webhook] phone captured', { sid, outcome })
    }
  }

  const shown = text ?? ATTACHMENT_PLACEHOLDER
  conv.messages = [...conv.messages, { role: 'user' as Role, text: hasAttachment && text ? `${text}\n${ATTACHMENT_PLACEHOLDER}` : shown, at: at || now }].slice(-MAX_HISTORY)
  conv.seenIds = [...conv.seenIds, mid].slice(-30)
  conv.lastAt = Math.max(conv.lastAt, at || now)
  conv.lastUserAt = at || now
  conv.draft = null // a new message makes an old draft stale

  const aiDoc = (await database.doc(`studios/${sid}/settings/ai`).get()).data() as AiSettingsDoc | undefined
  const mode = aiDoc?.instagramMode ?? 'off'
  const apiKey = process.env.ANTHROPIC_API_KEY
  const action = instagramAction({
    mode,
    humanHolds: conv.status === 'human',
    aiReady: Boolean(apiKey && aiDoc),
    readable: Boolean(text),
    canSend: Boolean(config),
  })

  // Nobody answers automatically: switch off, a human holds it, keys missing — or she sent something
  // the model cannot read (a photo, a voice note). The desk is told, with the reason.
  if (action === 'store' || !apiKey || !aiDoc) {
    conv.needsAttention = true
    conv.attentionReason = 'unanswered'
    await ref.set(conv, { merge: true })
    logger.info('[ig-webhook] stored, no AI', { sid, mode, status: conv.status, readable: Boolean(text) })
    return
  }

  const memberFirstName = conv.phone ? await whoIsWriting(database, ctx, conv.phone) : null
  const who = [whoBlock(memberFirstName), channelBlock(Boolean(conv.phone))].filter(Boolean).join('\n\n')
  const facts = await liveFacts(database, ctx, aiDoc.priceList)
  const result = await aiReply(apiKey, buildSystem(aiDoc), facts, who, conv.messages)
  if (!result) {
    conv.needsAttention = true
    conv.attentionReason = 'ai_failed'
    await ref.set(conv, { merge: true })
    return
  }

  if (result.stage) {
    conv.stage = result.stage
    conv.reason = result.reason
    if (conv.phone) await huniyiIlerlet(database, ctx, conv.phone, result.stage, SOURCE)
  }

  if (action === 'send' && config) {
    const sent = await sendInstagramText(config, igsid, result.reply)
    if (sent.ok) {
      conv.messages = [...conv.messages, { role: 'assistant' as Role, text: result.reply, at: Date.now() }].slice(-MAX_HISTORY)
      if (sent.ref) conv.seenIds = [...conv.seenIds, sent.ref].slice(-30) // so its echo is recognised as ours
      conv.needsAttention = false
    } else {
      // Could not send: keep it as a draft so the desk can send it by hand, and say why.
      conv.draft = { text: result.reply, at: Date.now() }
      conv.needsAttention = true
      conv.attentionReason = 'ai_failed'
      logger.warn('[ig-webhook] auto send failed', { sid, code: sent.code })
    }
  } else {
    // action === 'draft' (draft mode, or auto with no Meta config): prepare, never send.
    conv.draft = { text: result.reply, at: Date.now() }
    conv.needsAttention = false
  }

  if (result.escalate) {
    conv.needsAttention = true
    conv.attentionReason = result.hot ? 'hot_lead' : 'handoff'
    // Out of the building only when we can name her by phone — the alert carries a number to call.
    if (result.hot && conv.phone) await tellTheDesk(sid, conv, conv.phone)
  }
  await ref.set(conv, { merge: true })
  logger.info('[ig-webhook] processed', { sid, mode, drafted: Boolean(conv.draft), escalate: result.escalate })
}

export const instagramWebhook = onRequest({ region: REGION, secrets: [...INSTAGRAM_RECEPTIONIST_SECRETS] }, async (req, res) => {
  const sid = (req.path ?? '').replace(/^\/+/, '').split('/')[0] || 'retro'

  // ── GET: Meta's one-time verification handshake ──
  if (req.method === 'GET') {
    const ok = req.query['hub.mode'] === 'subscribe' && Boolean(process.env.INSTAGRAM_VERIFY_TOKEN) && req.query['hub.verify_token'] === process.env.INSTAGRAM_VERIFY_TOKEN
    if (ok) res.status(200).send(String(req.query['hub.challenge'] ?? ''))
    else res.status(403).send('forbidden')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).send('method not allowed')
    return
  }

  // ── POST: signed by Meta, or refused ──
  const raw = req.rawBody ?? Buffer.from('')
  if (!verifyMetaSignature(raw, req.get('x-hub-signature-256'), process.env.META_APP_SECRET ?? '')) {
    logger.warn('[ig-webhook] refused: bad or missing signature', { sid, configured: Boolean(process.env.META_APP_SECRET) })
    res.status(401).send('bad signature')
    return
  }

  try {
    const body = JSON.parse(raw.toString('utf8') || '{}') as unknown
    for (const m of parseInstagramWebhook(body)) {
      if (m.kind === 'echo') await processEcho(sid, m.igsid, m.mid, m.text, m.at)
      else await processMessage(sid, m.igsid, m.mid, m.text, m.hasAttachment, m.at, m.adId)
    }
  } catch (e) {
    logger.error('[ig-webhook] POST failed', (e as Error)?.message ?? e)
  }
  // Always 200 once the signature is good, so Meta doesn't storm retries; failures are logged and
  // surfaced to the desk.
  res.status(200).send('OK')
})
