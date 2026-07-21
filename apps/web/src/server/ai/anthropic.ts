import 'server-only'

import type { InsightSeverity } from '@studio/core'

import type { AdvisorItem } from '../advisor-query'

// The AI narrator — the FIRST real LLM call in the product (Phase 2). It takes the deterministic advisor
// items (already ranked, named, deep-linked) and re-prioritises + rephrases them into a warm Turkish
// "bugün ilgilenmen gerekenler" checklist. Gated on ANTHROPIC_API_KEY (Secret Manager → App Hosting
// runtime); with no key it returns null and the caller falls back to the deterministic list, so the
// feature works before the key and gets smarter after.
//
// PII (#6, KVKK): a member's NAME never reaches the model. Each name is replaced with an opaque token
// (⟦m1⟧) before the call and substituted back in the response. The model only ever sees kinds, amounts,
// day-counts and tokens.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001' // fast + cheap; a daily briefing does not need a frontier model

export interface ChecklistItem {
  readonly id: string
  readonly headline: string
  readonly note: string
  readonly severity: InsightSeverity
  readonly href: string
  readonly actionLabel: string
}
export interface DailyChecklist {
  readonly intro: string | null // a warm one-line briefing over the list
  readonly items: readonly ChecklistItem[]
  readonly aiGenerated: boolean
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const SYSTEM = `Sen bir butik pilates & fitness stüdyosunun deneyimli resepsiyon asistanısın. Sana bugün ilgilenilmesi gereken işlerin bir listesi JSON olarak veriliyor. Görevin: bunları resepsiyondaki kişiye net bir "bugün yapılacaklar" listesi olarak sunmak.

Kurallar:
- SADECE verilen maddeleri kullan. Yeni bilgi, isim, tutar, tarih UYDURMA.
- Aciliyet + etkiye göre sırala (en önemli en üstte). Aynı türden çok madde varsa mantıklı sırala.
- Her madde için kısa, sıcak ve EYLEME dönük Türkçe yaz. "headline" tek satır, "note" bir cümle öneri.
- ⟦m1⟧ gibi köşeli-parantez token'ları AYNEN koru (bunlar üye adlarının yerini tutuyor, değiştirme/çevirme).
- "intro": tüm günü 1 cümlede özetle + neyle başlanmalı (ör. "Bugün 6 iş var; önce 3 tahsilatı arayın.").
- Yanıtı YALNIZCA geçerli JSON olarak ver, markdown/kod bloğu YOK.

Yanıt biçimi:
{"intro":"...","items":[{"id":"<verilen id>","headline":"...","note":"..."}]}`

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

export async function narrateChecklist(items: readonly AdvisorItem[], studioName: string, tone?: string): Promise<DailyChecklist | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || items.length === 0) return null
  const system = tone && tone.trim() ? `${SYSTEM}\n\nStüdyonun tercih ettiği üslup: ${tone.trim()}` : SYSTEM

  // ── Tokenise every subject name out (PII never leaves) ─────────────────────────────────────
  const nameByToken = new Map<string, string>()
  const tokenByName = new Map<string, string>()
  let n = 0
  const tokenize = (s: string): string => {
    let out = s
    for (const it of items) {
      const nm = it.subject?.name
      if (!nm || nm === 'Bilinmeyen') continue
      let tok = tokenByName.get(nm)
      if (!tok) {
        tok = `⟦m${++n}⟧`
        tokenByName.set(nm, tok)
        nameByToken.set(tok, nm)
      }
      out = out.split(nm).join(tok)
    }
    return out
  }
  const detokenize = (s: string): string => {
    let out = String(s ?? '')
    for (const [tok, nm] of nameByToken) out = out.split(tok).join(nm)
    return out
  }

  const aiItems = items.map((it) => ({ id: it.id, kind: it.kind, severity: it.severity, text: tokenize(`${it.title} — ${it.detail}`) }))

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: JSON.stringify({ studio: studioName, items: aiItems }) }],
      }),
      // A daily briefing must never hang the dashboard — cap the wait, fall back to deterministic.
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.[0]?.text
    if (!text) return null
    const parsed = JSON.parse(extractJson(text)) as { intro?: string; items?: { id?: string; headline?: string; note?: string }[] }

    const byId = new Map(items.map((it) => [it.id, it]))
    const out: ChecklistItem[] = []
    for (const x of parsed.items ?? []) {
      const orig = x.id ? byId.get(x.id) : undefined
      if (!orig) continue // never surface an item the AI invented — only re-order/rephrase real ones
      out.push({
        id: orig.id,
        headline: detokenize(x.headline || orig.title),
        note: detokenize(x.note || orig.detail),
        severity: orig.severity,
        href: orig.href,
        actionLabel: orig.actionLabel,
      })
    }
    if (out.length === 0) return null
    return { intro: detokenize(parsed.intro || '') || null, items: out, aiGenerated: true }
  } catch {
    // Any failure (network, timeout, bad JSON) → deterministic fallback. The desk is never blocked.
    return null
  }
}
