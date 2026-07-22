import 'server-only'

import { PATRON_ACTION_KINDS, type PatronActionKind } from '@/lib/patron/actions'

import type { PatronNamedRef, PatronSnapshot } from '../patron-snapshot'

// The AI PATRON ASISTANI (Phase 2) — the owner's conversational, business-aware counterpart to the
// reception AI. It answers the owner's questions and writes a weekly briefing, ALWAYS grounded in the
// deterministic patron snapshot. Two disciplines carry it:
//   • It never invents a number. Every figure it cites is one we handed it; it may only narrate and
//     interpret. Critical figures are also rendered as real UI, so a slip can't drive a decision.
//   • No member PII reaches the model. Names are tokenised (⟦m1⟧) before the call and substituted back
//     in the answer (#6, KVKK) — the model sees kinds, counts, amounts and tokens.
// It may SUGGEST an action, but only a kind from the fixed registry; the owner confirms every send.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5' // reasoning over the business + judgement on what to act on; low volume

export interface PatronReply {
  readonly answer: string
  readonly actions: readonly PatronActionKind[]
  readonly aiGenerated: boolean
}

export function patronConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const tl = (kurus: number) => `${Math.round(kurus / 100).toLocaleString('tr-TR')} ₺`
const pctDelta = (now: number, prev: number): string => {
  if (prev <= 0) return now > 0 ? '(geçen ay veri yok)' : '(değişim yok)'
  const d = Math.round(((now - prev) / prev) * 100)
  return `(geçen aya göre ${d >= 0 ? '+' : ''}%${d})`
}

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

// Build the tokeniser over every named member in the snapshot, and the human-readable, tokenised data
// block the model reasons over. Returns the block plus a detokeniser for the answer.
function prepare(snap: PatronSnapshot): { block: string; detokenize: (s: string) => string } {
  const nameByToken = new Map<string, string>()
  const tokenByName = new Map<string, string>()
  let n = 0
  const tok = (name: string): string => {
    let t = tokenByName.get(name)
    if (!t) {
      t = `⟦m${++n}⟧`
      tokenByName.set(name, t)
      nameByToken.set(t, name)
    }
    return t
  }
  const list = (rows: readonly PatronNamedRef[]) => rows.map((r) => `${tok(r.name)} (${r.detail})`).join(', ') || '—'
  const m = snap.money
  const mem = snap.members
  const op = snap.operations

  const block = [
    `Tarih: ${snap.date}`,
    '',
    'PARA:',
    `- Bugün satış: ${tl(m.todaySalesKurus)}, tahsilat: ${tl(m.todayCollectedKurus)}`,
    `- Bu ay satış: ${tl(m.monthSalesKurus)} ${pctDelta(m.monthSalesKurus, m.prevMonthSalesKurus)}, tahsilat: ${tl(m.monthCollectedKurus)} ${pctDelta(m.monthCollectedKurus, m.prevMonthCollectedKurus)}`,
    `- Geçen ay satış: ${tl(m.prevMonthSalesKurus)}, tahsilat: ${tl(m.prevMonthCollectedKurus)}`,
    `- Açık bakiye (borç): toplam ${tl(m.pendingTotalKurus)}, ${m.pendingCount} kişi`,
    '',
    'ÜYELER:',
    `- Aktif üye: ${mem.active}, son 30 günde yeni: ${mem.new30d}`,
    `- Süresi dolmak üzere: ${mem.expiringCount} kişi — ${list(mem.expiring)}`,
    `- Ders hakkı azalan: ${mem.lowCreditCount} kişi — ${list(mem.lowCredit)}`,
    `- Uzaklaşan (aktif ama gelmiyor): ${mem.dormantCount} kişi — ${list(mem.dormant)}`,
    `- Borçlular: ${list(mem.debtors)}`,
    '',
    'OPERASYON:',
    `- Bugün doluluk: ${op.occupancyBooked}/${op.occupancyCapacity}`,
    `- Boş seans: önümüzdeki 48 saatte ${op.emptyNext48h}, 7 günde ${op.emptyNext7d}`,
    '',
    'WHATSAPP LEAD (son 30 gün):',
    `- Yazan: ${snap.leads.wrote}, konuşmaya devam eden: ${snap.leads.engaged}, sıcak: ${snap.leads.hot}`,
  ].join('\n')

  const detokenize = (s: string): string => {
    let out = String(s ?? '')
    for (const [t, name] of nameByToken) out = out.split(t).join(name)
    return out
  }
  return { block, detokenize }
}

const ACTION_GUIDE = `Kullanabileceğin aksiyon kodları (sadece gerçekten uygunsa öner, 0-3 tane):
- "remind_debtors": borçlu üyelere ödeme hatırlatması (açık bakiye varsa).
- "renew_expiring": süresi dolan üyelere yenileme daveti.
- "winback_dormant": uzaklaşan üyelere dönüş mesajı.
- "draft_campaign": boş kapasite/kampanya için taslak hazırlama.
Aksiyonu SADECE ilgili veri varken öner (ör. borç yoksa remind_debtors önerme).`

const SYSTEM = `Sen bir butik, kadınlara özel Pilates & Fitness stüdyosunun işletme (patron) asistanısın. Stüdyo sahibiyle konuşuyorsun. Sana işletmenin GÜNCEL verileri veriliyor; görevin bu veriyle sahibin sorusunu net, samimi ve EYLEME dönük Türkçe cevaplamak.

Kurallar:
- SADECE sana verilen sayıları kullan. Yeni rakam, tutar, yüzde, isim UYDURMA. Veri yoksa "bu konuda veri yok" de.
- Kısa ve öz ol. Rakamı söyle, ne anlama geldiğini yorumla, gerekiyorsa 1 net öneri ver.
- ⟦m1⟧ gibi token'ları AYNEN koru — bunlar üye adlarının yerini tutuyor, değiştirme/çevirme.
- Uygunsa fixed aksiyon kodlarından öner (aşağıda). Emin değilsen aksiyon önerme.
- Yanıtı YALNIZCA geçerli JSON ver, markdown/kod bloğu YOK:
{"answer":"...","actions":["remind_debtors"]}

${ACTION_GUIDE}`

const BRIEFING_INSTRUCTION = `Sahibe HAFTALIK bir patron brifingi yaz. Şu yapıda, kısa ve net:
- 1 cümle genel durum (bu hafta/ay nasıl gidiyor, geçen aya göre).
- Dikkat edilmesi gereken 2-3 madde (borç, kaçan üye, boş kapasite, süresi dolanlar — hangileri önemliyse).
- Bu hafta için 1-2 somut öneri.
Sıcak ama profesyonel bir üslup. Uygun aksiyon kodlarını öner.`

async function call(system: string, userContent: string): Promise<{ answer: string; actions: PatronActionKind[] } | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: userContent }] }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.[0]?.text
    if (!text) return null
    const parsed = JSON.parse(extractJson(text)) as { answer?: string; actions?: unknown }
    const answer = typeof parsed.answer === 'string' ? parsed.answer : ''
    if (!answer.trim()) return null
    const actions = Array.isArray(parsed.actions)
      ? (parsed.actions.filter((a): a is PatronActionKind => typeof a === 'string' && (PATRON_ACTION_KINDS as string[]).includes(a)) as PatronActionKind[])
      : []
    return { answer, actions: [...new Set(actions)] }
  } catch {
    return null
  }
}

export async function askPatron(question: string, snap: PatronSnapshot, tone?: string): Promise<PatronReply | null> {
  const { block, detokenize } = prepare(snap)
  const system = tone && tone.trim() ? `${SYSTEM}\n\nStüdyonun tercih ettiği üslup: ${tone.trim()}` : SYSTEM
  const out = await call(system, `İşletme verisi:\n${block}\n\nSahibin sorusu: ${question.trim()}`)
  if (!out) return null
  return { answer: detokenize(out.answer), actions: out.actions, aiGenerated: true }
}

export async function patronBriefing(snap: PatronSnapshot, tone?: string): Promise<PatronReply | null> {
  const { block, detokenize } = prepare(snap)
  const system = tone && tone.trim() ? `${SYSTEM}\n\nStüdyonun tercih ettiği üslup: ${tone.trim()}` : SYSTEM
  const out = await call(system, `İşletme verisi:\n${block}\n\n${BRIEFING_INSTRUCTION}`)
  if (!out) return null
  return { answer: detokenize(out.answer), actions: out.actions, aiGenerated: true }
}
