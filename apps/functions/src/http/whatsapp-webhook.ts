// The WhatsApp AI receptionist — inbound webhook (Faz 2, Blok 2a). Built on the paytr-callback pattern.
//
// Meta calls this URL two ways:
//   • GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  — the one-time verification handshake.
//   • POST { entry: [{ changes: [{ value: { messages, contacts } } }] } }  — an inbound message.
//
// On an inbound TEXT message we: store the conversation (studios/{sid}/conversations/{phone}), and — ONLY
// if the owner has flipped `settings/ai.whatsappActive` ON — ask Claude for a reply from the studio's
// knowledge card (settings/ai) + LIVE facts (active products/prices, today/tomorrow availability) + the
// conversation history, then send it back with a free-form text message (allowed inside the 24h window).
// PII (name/phone/message text) lives on the conversation doc (server-only), NEVER in an event. The model
// sees the customer's own words (unavoidable for a reply) but no other member's data.
import {
  FirestoreCatalogRepository,
  FirestoreSchedulingRepository,
  instant,
  sendWhatsAppText,
  type ClassSession,
  type MetaWhatsAppConfig,
  type Product,
  type TenantContext,
} from '@studio/core'
import type { Firestore } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'

import { db } from '../shared/firebase'
import { AI_RECEPTIONIST_SECRETS, REGION } from '../shared/region'

const OFFSET_MIN = 180 // TRT = UTC+3, no DST
const MAX_HISTORY = 24 // messages kept per conversation for context + storage
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'

type Role = 'user' | 'assistant'
interface Msg {
  role: Role
  text: string
  at: number
}
interface Conversation {
  phone: string
  name: string
  status: 'ai' | 'human'
  needsAttention: boolean
  lastAt: number
  seenIds: string[]
  messages: Msg[]
}

interface AiSettingsDoc {
  tone?: string
  identity?: string
  basics?: string
  policies?: string
  faq?: { q: string; a: string }[]
  escalation?: string
  neverDo?: string
  examples?: string
  whatsappActive?: boolean
}

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} TL`
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const dayShort = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'short', day: 'numeric', month: 'short' })

function ctxOf(sid: string): TenantContext {
  return { studioId: sid as never, branchIds: [], role: 'owner', actor: { type: 'system', id: 'whatsapp_webhook' } as TenantContext['actor'] }
}

// Compact LIVE facts the reply must be grounded in — active packages with prices and the next sessions
// with free seats. Read straight from Firestore (same repos paytr-callback uses).
async function liveFacts(database: Firestore, ctx: TenantContext): Promise<string> {
  const parts: string[] = []
  try {
    const products = (await new FirestoreCatalogRepository(database).listProducts(ctx)).filter((p: Product) => p.active)
    const surcharge = ((await database.doc(`studios/${ctx.studioId}/settings/studio`).get()).get('paymentSurcharge')?.cardTransferSurchargeKurus as number | undefined) ?? 0
    if (products.length) {
      parts.push('GÜNCEL PAKETLER (fiyatlar buradan, ASLA uydurma):')
      for (const p of products) {
        const kk = surcharge > 0 ? ` / Kredi Kartı: ${tl(p.priceInKurus + surcharge)}` : ''
        const detail = p.type === 'credit' ? `${p.creditCount ?? 0} ders / ${p.durationDays} gün` : `${p.durationDays} gün sınırsız`
        parts.push(`- ${p.name} (${detail}): Nakit ${tl(p.priceInKurus)}${kk}`)
      }
    }
  } catch (e) {
    logger.warn('[wa-webhook] product facts failed', (e as Error)?.message)
  }
  try {
    const now = Date.now()
    const trt = new Date(now + OFFSET_MIN * 60_000)
    const midnight = Date.UTC(trt.getUTCFullYear(), trt.getUTCMonth(), trt.getUTCDate()) - OFFSET_MIN * 60_000
    const sessions = await new FirestoreSchedulingRepository(database).listSessionsForDay(ctx, instant(midnight), instant(midnight + 2 * 86_400_000))
    const open = sessions
      .filter((s: ClassSession) => (s.startsAt as number) >= now && s.status === 'scheduled' && s.capacity - s.bookedCount > 0)
      .sort((a: ClassSession, b: ClassSession) => (a.startsAt as number) - (b.startsAt as number))
      .slice(0, 12)
    if (open.length) {
      parts.push('\nYAKLAŞAN UYGUN DERSLER (yer olanlar):')
      for (const s of open) parts.push(`- ${dayShort(s.startsAt as number)} ${hhmm(s.startsAt as number)} · ${s.serviceName} · ${s.capacity - s.bookedCount} yer boş`)
    }
  } catch (e) {
    logger.warn('[wa-webhook] session facts failed', (e as Error)?.message)
  }
  return parts.join('\n')
}

function buildSystem(ai: AiSettingsDoc, facts: string): string {
  const kb: string[] = []
  if (ai.identity) kb.push(`KİMLİK: ${ai.identity}`)
  if (ai.basics) kb.push(`TEMEL BİLGİLER:\n${ai.basics}`)
  if (ai.policies) kb.push(`POLİTİKALAR:\n${ai.policies}`)
  if (ai.faq?.length) kb.push('SIK SORULANLAR:\n' + ai.faq.map((f) => `S: ${f.q}\nC: ${f.a}`).join('\n'))
  if (ai.escalation) kb.push(`İNSANA DEVRET (bu durumlarda escalate=true yap):\n${ai.escalation}`)
  if (ai.neverDo) kb.push(`ASLA YAPMA:\n${ai.neverDo}`)
  if (ai.examples) kb.push(`ÖRNEK ÜSLUP:\n${ai.examples}`)
  return `Sen bir butik, KADINLARA ÖZEL pilates & fitness stüdyosunun WhatsApp resepsiyonistisin. Deneyimli bir çalışan gibi, sıcak ve çözüm-odaklı konuş.

${ai.tone ? `ÜSLUP: ${ai.tone}\n` : ''}
${kb.join('\n\n')}

${facts ? `— CANLI VERİ —\n${facts}\n` : ''}
KURALLAR:
- SADECE yukarıdaki bilgi ve canlı veriden konuş. Fiyat/program/tarih UYDURMA. Bilmiyorsan escalate=true yap.
- Türkçe, kısa, samimi. Emoji kullanabilirsin (abartma).
- Kesin taahhüt (rezervasyon/ödeme) verme; bunları yaparken escalate=true yap.
- Müşteri insanla görüşmek isterse ya da şikayet/iade/sağlık/pazarlık olursa escalate=true yap.

Yanıtı YALNIZCA şu JSON olarak ver (markdown yok):
{"reply":"müşteriye gidecek mesaj","escalate":true/false}`
}

function extractJson(t: string): string {
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}

async function aiReply(apiKey: string, system: string, history: Msg[]): Promise<{ reply: string; escalate: boolean } | null> {
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: history.map((m) => ({ role: m.role, content: m.text })) }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      logger.warn('[wa-webhook] anthropic', res.status)
      return null
    }
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.[0]?.text
    if (!text) return null
    const parsed = JSON.parse(extractJson(text)) as { reply?: string; escalate?: boolean }
    if (!parsed.reply) return null
    return { reply: parsed.reply, escalate: Boolean(parsed.escalate) }
  } catch (e) {
    logger.warn('[wa-webhook] anthropic failed', (e as Error)?.message)
    return null
  }
}

async function processMessage(sid: string, from: string, name: string, text: string, msgId: string): Promise<void> {
  const database = db()
  const ctx = ctxOf(sid)
  const ref = database.doc(`studios/${sid}/conversations/${from}`)
  const snap = await ref.get()
  const conv = (snap.data() as Conversation | undefined) ?? { phone: from, name, status: 'ai', needsAttention: false, lastAt: 0, seenIds: [], messages: [] }
  if (conv.seenIds.includes(msgId)) return // idempotent: Meta retries the same message id

  const now = Date.now()
  conv.name = conv.name || name
  conv.messages = [...conv.messages, { role: 'user' as Role, text, at: now }].slice(-MAX_HISTORY)
  conv.seenIds = [...conv.seenIds, msgId].slice(-30)
  conv.lastAt = now

  const aiDoc = (await database.doc(`studios/${sid}/settings/ai`).get()).data() as AiSettingsDoc | undefined
  const active = Boolean(aiDoc?.whatsappActive)
  const apiKey = process.env.ANTHROPIC_API_KEY
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID

  // AI replies only when: the master switch is ON, the conversation isn't already with a human, and the
  // keys are present. Otherwise the message is just stored + flagged for the desk.
  if (!active || conv.status === 'human' || !apiKey || !token || !phoneId || !aiDoc) {
    conv.needsAttention = true
    await ref.set(conv, { merge: true })
    logger.info('[wa-webhook] stored, no auto-reply', { sid, active, status: conv.status })
    return
  }

  const facts = await liveFacts(database, ctx)
  const system = buildSystem(aiDoc, facts)
  const result = await aiReply(apiKey, system, conv.messages)
  if (!result) {
    conv.needsAttention = true
    await ref.set(conv, { merge: true })
    return
  }

  const config: MetaWhatsAppConfig = { phoneNumberId: phoneId, accessToken: token, ...(process.env.WHATSAPP_API_VERSION ? { apiVersion: process.env.WHATSAPP_API_VERSION } : {}) }
  const sent = await sendWhatsAppText(config, from, result.reply)
  conv.messages = [...conv.messages, { role: 'assistant' as Role, text: result.reply, at: Date.now() }].slice(-MAX_HISTORY)
  if (result.escalate) {
    conv.status = 'human'
    conv.needsAttention = true
  }
  await ref.set(conv, { merge: true })
  logger.info('[wa-webhook] replied', { sid, escalate: result.escalate, sent: sent.ok })
}

export const whatsappWebhook = onRequest({ region: REGION, secrets: [...AI_RECEPTIONIST_SECRETS] }, async (req, res) => {
  const sid = (req.path ?? '').replace(/^\/+/, '').split('/')[0] || 'retro'

  // ── GET: Meta verification handshake ──
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(String(challenge ?? ''))
      return
    }
    res.status(403).send('forbidden')
    return
  }

  // ── POST: inbound messages ──
  try {
    const body = (typeof req.body === 'object' ? req.body : JSON.parse(req.rawBody?.toString('utf8') || '{}')) as {
      entry?: { changes?: { value?: { contacts?: { profile?: { name?: string }; wa_id?: string }[]; messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[] } }[] }[]
    }
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {}
        const nameByWa = new Map<string, string>()
        for (const c of value.contacts ?? []) if (c.wa_id) nameByWa.set(c.wa_id, c.profile?.name ?? '')
        for (const m of value.messages ?? []) {
          if (m.type !== 'text' || !m.from || !m.id || !m.text?.body) continue
          await processMessage(sid, m.from, nameByWa.get(m.from) ?? '', m.text.body, m.id)
        }
      }
    }
  } catch (e) {
    logger.error('[wa-webhook] POST failed', (e as Error)?.message ?? e)
  }
  // Always 200 so Meta doesn't storm retries; failures are logged + surfaced to the desk.
  res.status(200).send('OK')
})
