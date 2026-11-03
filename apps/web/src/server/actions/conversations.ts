'use server'

import {
  FirestoreCrmRepository,
  instagramWindowOpen,
  sendInstagramText,
  sendWhatsAppText,
  type MetaInstagramConfig,
  type MetaWhatsAppConfig,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// The reception/operator side of the WhatsApp AI receptionist. The conversations collection is
// server-only (buyer PII), so the panel reaches it ONLY through these actions (Admin SDK). Reception
// can watch what the AI is saying, take a conversation over from the AI, reply, and hand it back.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const MAX_HISTORY = 40
// A conversation KEY is its document id: the phone for WhatsApp, `ig_<igsid>` for Instagram (IG-1).
// It becomes a Firestore path segment, so it is held to the characters those ids actually use — a
// `/` here would address a different document.
const convKey = z.string().trim().regex(/^[A-Za-z0-9_+]{3,80}$/)

export interface ConvMsg {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly at: number
}
export type Temp = 'sıcak' | 'ılık' | 'soğuk'
export type Channel = 'whatsapp' | 'instagram'
export interface ConvSummary {
  // The conversation's identity (document id). WhatsApp: the phone. Instagram: `ig_<igsid>` (IG-1).
  // Everything the panel selects, links to or acts on goes by THIS, never by `phone`.
  readonly key: string
  readonly channel: Channel
  // A REAL phone or ''. On Instagram it is '' until she writes one (owner: the lead waits for it).
  readonly phone: string
  readonly handle: string // Instagram username, '' when unknown / on WhatsApp
  readonly name: string
  readonly status: 'ai' | 'human'
  readonly needsAttention: boolean
  // Why the desk is being called: the assistant handed over, or the assistant failed. Same badge,
  // different sentence — and a very different reaction.
  // `hot_lead` (2026-07-27) — she said she is ready to sign up. A different alert and a different
  // urgency from a problem handover; see whatsapp-dock.tsx.
  // `unanswered` (2026-09-29) — müşteri yazdı ve otomatik cevap gelmeyecek. Panel ve bir migration
  // bunu ZATEN yazıyordu; eksik olan tek şey burada tanımlı olmasıydı, ve eksik tanım dock'u
  // varsayılan dala düşürüp bekleyen müşteriyi yeşil bir başarı bildirimi yapıyordu.
  readonly attentionReason: 'handoff' | 'ai_failed' | 'hot_lead' | 'unanswered' | null
  readonly lastAt: number
  readonly lastText: string
  readonly temp: Temp | null // AI's read of conversion likelihood
  readonly reason: string // one-line why (AI estimate — an aid, not truth)
  // Instagram draft mode: the AI's prepared reply, sent only when a human presses Gönder.
  readonly draft: { readonly text: string; readonly at: number } | null
  // Can a free-form reply still reach her? Instagram: 24 h after her last message. WhatsApp: the
  // panel never measured it and Meta refuses outside it — reported as a send failure, as before.
  readonly replyWindowOpen: boolean
}
export interface ConvDetail extends ConvSummary {
  readonly messages: readonly ConvMsg[]
}

function summarize(id: string, c: Record<string, unknown>, now = Date.now()): ConvSummary {
  const msgs = (c.messages as ConvMsg[] | undefined) ?? []
  const last = msgs[msgs.length - 1]
  const temp = c.temp === 'sıcak' || c.temp === 'ılık' || c.temp === 'soğuk' ? (c.temp as Temp) : null
  // No `channel` field = WhatsApp: every document written before IG-1.
  const channel: Channel = c.channel === 'instagram' ? 'instagram' : 'whatsapp'
  const d = c.draft as { text?: unknown; at?: unknown } | null | undefined
  return {
    key: id,
    channel,
    phone: channel === 'instagram' ? String(c.phone ?? '') : String(c.phone ?? id),
    handle: String(c.handle ?? ''),
    draft: d && typeof d.text === 'string' && d.text.trim() !== '' ? { text: d.text, at: Number(d.at ?? 0) } : null,
    replyWindowOpen: channel === 'instagram' ? instagramWindowOpen(c.lastUserAt as number | undefined, now) : true,
    name: String(c.name ?? ''),
    status: (c.status as 'ai' | 'human') ?? 'ai',
    needsAttention: Boolean(c.needsAttention),
    attentionReason: (c.attentionReason as ConvSummary['attentionReason'] | undefined) ?? null,
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
  return snap.docs.map((d) => summarize(d.id, d.data()))
}

// ── REKLAM DÖNEMİ AYRACI (owner, 2026-09-15) ──────────────────────────────────────────────────
//
// *"15 Eylül reklamından gelenler diye ayraç olsun, eski konuşmaları getirmesine gerek yok, en altta
// eski konuşmaları getir deyince getirsin."* Hat üyelerin de hattı (ders iptali, şifre), o yüzden
// owner kararıyla dönemde yazan ESKİ tanıdıklar gizlenmez — ayrı ayraçta durur:
//
//   new    — dönem başladıktan sonra İLK KEZ yazanlar ("15 Eylül reklamından gelenler")
//   known  — önceden tanıdığımız, bu dönemde yazmış olanlar
//   older  — dönemde hiç yazmamış eski konuşmalar; yalnızca "Eski konuşmaları getir" ile
//
// İlk temas: `firstAt` (webhook 2026-09-15'ten beri yazıyor) ya da bu dönemde açılmış bir aday kaydı
// ya da en eski saklı mesaj. Webhook sohbet başına son 24 mesajı tutuyor; bu kadar uzun bir sohbetin
// ilk mesajı düşmüş olabilir — o yüzden eşiğe yaklaşan ve `firstAt`ı olmayan sohbet "yeni" SAYILMAZ.
export type InboxGroup = 'new' | 'known' | 'older'
export interface InboxItem extends ConvSummary {
  readonly group: InboxGroup
}
export interface Inbox {
  readonly period: { readonly label: string; readonly startedAt: number } | null
  readonly items: readonly InboxItem[]
}
const HISTORY_TRUST = 20
const OLDER_PAGE = 50

function firstContact(c: Record<string, unknown>): number | null {
  if (typeof c.firstAt === 'number') return c.firstAt
  const msgs = (c.messages as ConvMsg[] | undefined) ?? []
  if (msgs.length >= HISTORY_TRUST) return null
  return msgs[0]?.at ?? null
}

export async function listInboxAction(): Promise<Inbox> {
  const ctx = await requireTenantContext(OPS)
  const col = adminDb().collection(`studios/${ctx.studioId}/conversations`)
  const crm = new FirestoreCrmRepository(adminDb())
  const period = await crm.getCurrentAdPeriod(ctx)
  if (!period) {
    const snap = await col.orderBy('lastAt', 'desc').limit(100).get()
    return { period: null, items: snap.docs.map((d) => ({ ...summarize(d.id, d.data()), group: 'known' as const })) }
  }
  const start = period.startedAt as number
  // Tek alanlı aralık + aynı alanda sıralama: otomatik indeks yeter.
  const [snap, yeniAdaylar] = await Promise.all([
    col.where('lastAt', '>=', start).orderBy('lastAt', 'desc').limit(300).get(),
    crm.listLeadsSince(ctx, start),
  ])
  const yeniTelefon = new Set(yeniAdaylar.map((l) => l.phone))
  const items = snap.docs.map((d) => {
    const c = d.data()
    const ilk = firstContact(c)
    const yeni = yeniTelefon.has(String(c.phone || d.id)) || (ilk !== null && ilk >= start)
    return { ...summarize(d.id, c), group: yeni ? ('new' as const) : ('known' as const) }
  })
  return { period: { label: period.label, startedAt: start }, items }
}

/** Dönemde yazmamış eski konuşmalar, sayfa sayfa (`lastAt < before`, yeniden eskiye). */
export async function listOlderConversationsAction(input: unknown): Promise<readonly InboxItem[]> {
  const p = z.object({ before: z.number().int().positive() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb()
    .collection(`studios/${ctx.studioId}/conversations`)
    .where('lastAt', '<', p.before)
    .orderBy('lastAt', 'desc')
    .limit(OLDER_PAGE)
    .get()
  return snap.docs.map((d) => ({ ...summarize(d.id, d.data()), group: 'older' as const }))
}

export async function getConversationAction(input: unknown): Promise<ConvDetail | null> {
  const p = z.object({ key: convKey }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb().doc(`studios/${ctx.studioId}/conversations/${p.key}`).get()
  if (!snap.exists) return null
  const c = snap.data() as Record<string, unknown>
  return { ...summarize(snap.id, c), messages: (c.messages as ConvMsg[] | undefined) ?? [] }
}

// Reception sends a reply (free-form, valid inside the 24h window). A TYPED reply also TAKES OVER the
// conversation: status → 'human', so the AI stops until it is handed back.
//
// INSTAGRAM DRAFT (IG-1): `fromDraft: true` is the desk pressing Gönder under the AI's prepared reply
// (edited or not). That is the AI's turn approved by a human, not a takeover — the status stays, so the
// next message gets a draft again. Either way the draft is cleared: it has been answered.
export type ReplyError = 'whatsapp_not_configured' | 'instagram_not_configured' | 'window_closed' | 'not_found' | 'send_failed'

export async function replyConversationAction(input: unknown) {
  const p = z
    .object({ key: convKey, text: z.string().trim().min(1).max(4000), fromDraft: z.boolean().default(false) })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  const ref = adminDb().doc(`studios/${ctx.studioId}/conversations/${p.key}`)
  const current = (await ref.get()).data() as Record<string, unknown> | undefined
  if (!current) return { ok: false as const, error: { code: 'not_found' as ReplyError } }
  const channel: Channel = current.channel === 'instagram' ? 'instagram' : 'whatsapp'

  let sentRef: string | undefined
  if (channel === 'instagram') {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
    const pageId = process.env.INSTAGRAM_PAGE_ID
    if (!accessToken || !pageId) return { ok: false as const, error: { code: 'instagram_not_configured' as ReplyError } }
    if (!instagramWindowOpen(current.lastUserAt as number | undefined, Date.now())) {
      return { ok: false as const, error: { code: 'window_closed' as ReplyError } }
    }
    const config: MetaInstagramConfig = { accessToken, pageId }
    const sent = await sendInstagramText(config, String(current.igsid ?? p.key.replace(/^ig_/, '')), p.text)
    if (!sent.ok) return { ok: false as const, error: { code: 'send_failed' as ReplyError }, detail: sent.code }
    sentRef = sent.ref
  } else {
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneId) return { ok: false as const, error: { code: 'whatsapp_not_configured' as ReplyError } }
    const config: MetaWhatsAppConfig = { phoneNumberId: phoneId, accessToken: token }
    const sent = await sendWhatsAppText(config, p.key, p.text)
    if (!sent.ok) return { ok: false as const, error: { code: 'send_failed' as ReplyError }, detail: sent.code }
  }

  const now = Date.now()
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const c = (snap.data() as Record<string, unknown> | undefined) ?? {}
    const msgs = ((c.messages as ConvMsg[] | undefined) ?? []).concat({ role: 'assistant', text: p.text, at: now }).slice(-MAX_HISTORY)
    const update: Record<string, unknown> = { needsAttention: false, lastAt: now, messages: msgs }
    if (!(channel === 'instagram' && p.fromDraft)) update.status = 'human'
    if (channel === 'instagram') {
      update.draft = null
      // Its echo comes back through the webhook; a recorded mid is how the webhook knows it is ours
      // and not Işıl answering from the Instagram app.
      if (sentRef) update.seenIds = ((c.seenIds as string[] | undefined) ?? []).concat(sentRef).slice(-30)
    }
    tx.set(ref, update, { merge: true })
  })
  return { ok: true as const }
}

// ── CEVAPSIZ BİR SORU KAPATILAMAZ (owner, 2026-09-01) ───────────────────────────────────────
//
// Bir müşteri 21 saat cevapsız kaldı ve nasıl olduğu şuydu: Işıl telefondan elle cevap yazdı,
// sohbet `human`a geçti (doğru), müşteri tekrar yazdı, AI susup resepsiyona işaret koydu (doğru) —
// ve sonra sohbet `ai`ya geri verilirken **o işaret, soru cevaplanmadan temizlendi.** AI yalnızca
// yeni mesaj gelince konuşur; yeni mesaj hiç gelmediği için soru sonsuza kadar orada kaldı.
//
// Yani kaybolan şey cevap değil, cevabın gerektiğini söyleyen tek işaretti.
//
// Kural: **son söz müşterideyse, "gördüm" ya da "AI'ya ver" o işareti kapatmaz.** Kapatan tek şey
// cevaptır (`replyConversationAction`, mesajı ekliyor). Kim ilgileniyor sorusuyla, ilgilenilmesi
// gerekiyor mu sorusu ayrı sorulardır; ikisini tek bayrağa bağlamak, ilkini değiştirmeyi ikincisini
// silmek yaptı.
//
// AI'ın devir-teslimde kendiliğinden cevap yazması bilerek YAPILMADI: insanın yarım bıraktığı bir
// konuşmaya AI'ın söze girmesi, sessizlikten daha kötü bir şey söyleyebilir. Sistem bildirir,
// insan karar verir.
const cevapBekliyor = (c: Record<string, unknown>): boolean => {
  const msgs = (c.messages as ConvMsg[] | undefined) ?? []
  return msgs[msgs.length - 1]?.role === 'user'
}

/** Devral ('human') ya da AI'ya geri ver ('ai'). Cevapsız soru varsa işaret KAPANMAZ. */
export async function setConversationStatusAction(input: unknown) {
  const p = z.object({ key: convKey, status: z.enum(['ai', 'human']) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const ref = adminDb().doc(`studios/${ctx.studioId}/conversations/${p.key}`)
  const c = ((await ref.get()).data() as Record<string, unknown>) ?? {}
  const bekliyor = cevapBekliyor(c)
  // "Ben cevaplayacağım" (IG-1) = Devral: the human takes it, so the AI's draft is withdrawn — a
  // draft nobody will send is a reply that looks pending forever.
  const withdraw = p.status === 'human' && c.channel === 'instagram' ? { draft: null } : {}
  await ref.set(
    bekliyor
      ? { status: p.status, needsAttention: true, attentionReason: 'unanswered', ...withdraw }
      : { status: p.status, needsAttention: false, ...withdraw },
    { merge: true },
  )
  return { ok: true as const, stillWaiting: bekliyor }
}

/** Resepsiyon gördü. Cevapsız soru varsa işaret yine KAPANMAZ — görmek cevap değildir. */
export async function markConversationSeenAction(input: unknown) {
  const p = z.object({ key: convKey }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const ref = adminDb().doc(`studios/${ctx.studioId}/conversations/${p.key}`)
  const bekliyor = cevapBekliyor(((await ref.get()).data() as Record<string, unknown>) ?? {})
  if (bekliyor) return { ok: true as const, stillWaiting: true }
  await ref.set({ needsAttention: false }, { merge: true })
  return { ok: true as const, stillWaiting: false }
}

// ── SOHBETE İLİŞTİRİLEN KALICI NOT (owner, 2026-10-02) ──────────────────────────────────────
//
// *"Kalıcı not için ayrı bir yer koy."* Sebebi şu: bugüne kadar bir lead hakkında yazılan tek not,
// panodaki TİK NOTUydu ve o bilerek geçici — tiki geri alınca not da siliniyor, çünkü o notun işi
// "bu işi kapattım, şöyle oldu" demek. Oysa masanın tutmak istediği başka bir şey var: kişinin
// kendisi hakkında kalıcı bir cümle ("fiyatı yüksek buldu, Ocak'ta tekrar ara").
//
// AYRI KOLEKSİYON, sohbet belgesinin üstünde bir alan DEĞİL. Webhook her gelen mesajda sohbeti
// bellekteki nesnesiyle baştan yazıyor (`ref.set(conv, { merge: true })`); bilmediği bir alan bugün
// hayatta kalır ama bir sonraki düzenlemede sessizce düşebilir. Notun kaderi, onu hiç tanımayan bir
// fonksiyonun dikkatine bağlı olmamalı.
//
// Sohbetin anahtarına göre (WhatsApp'ta telefon, Instagram'da `ig_<igsid>`): sohbetin kimliği de o. Üye kaydı olsun olmasın çalışır — ki
// lead'lerin çoğunun üye kaydı yok.
const noteRef = (studioId: string, key: string) =>
  adminDb().doc(`studios/${studioId}/conversationNotes/${key}`)

export interface ConversationNote {
  readonly text: string
  readonly byName: string
  readonly at: number
}

export async function conversationNoteAction(input: unknown): Promise<ConversationNote | null> {
  const p = z.object({ key: convKey }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const snap = await noteRef(String(ctx.studioId), p.key).get()
  const d = snap.data()
  if (!d || typeof d.text !== 'string' || d.text.trim() === '') return null
  return { text: String(d.text), byName: String(d.byName ?? ''), at: Number(d.at ?? 0) }
}

/**
 * Notu yaz, değiştir ya da sil — hepsi tek kapı.
 *
 * Boş metin SİLER. Ayrı bir "sil" eylemi yazmadım: iki eylem, iki yetki kontrolü ve iki kez
 * unutulabilecek bir kural demek. Kullanıcının yaptığı şey zaten tek: kutuyu boşaltıp kaydetmek.
 */
export async function setConversationNoteAction(input: unknown): Promise<{ ok: true }> {
  const p = z.object({ key: convKey, text: z.string().trim().max(1000) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const ref = noteRef(String(ctx.studioId), p.key)
  if (p.text === '') {
    await ref.delete()
    return { ok: true as const }
  }
  // Kim yazdı: masada birden fazla kişi var ve "bunu kim yazmış" sorusu notun kendisi kadar işe
  // yarıyor. Ad çözülemezse boş kalır — uydurulmuş bir ad, boş bir alandan kötüdür.
  let byName = ''
  try {
    const staff = await adminDb().doc(`studios/${ctx.studioId}/staff/${String(ctx.actor.id)}`).get()
    byName = String(staff.data()?.displayName ?? '')
  } catch {
    /* ad olmadan da yazılır */
  }
  await ref.set({ text: p.text, byName, at: Date.now(), by: String(ctx.actor.id) }, { merge: true })
  return { ok: true as const }
}
