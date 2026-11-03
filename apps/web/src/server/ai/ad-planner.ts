import 'server-only'

// IG-5a (2026-11-04) — the AI's campaign draft. It PROPOSES; the owner approves; the domain refuses
// anything over the caps (the AI is told the caps, and held to them all the same).
//
// What the model sees: the knowledge card's identity/basics/campaign, the area names, the studio's recent
// Instagram posts (id + first lines of the caption — to pick the creative), the caps, and the last 30
// days of ad results if any. No member data.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5-5'

export interface AdIdea {
  readonly name: string
  readonly dailyBudgetTl: number
  readonly days: number
  readonly ageMin: number
  readonly ageMax: number
  readonly radiusKm: number
  readonly igMediaId: string
  readonly rationale: string
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'dailyBudgetTl', 'days', 'ageMin', 'ageMax', 'radiusKm', 'igMediaId', 'rationale'],
  properties: {
    name: { type: 'string' },
    dailyBudgetTl: { type: 'integer' },
    days: { type: 'integer' },
    ageMin: { type: 'integer' },
    ageMax: { type: 'integer' },
    radiusKm: { type: 'integer' },
    igMediaId: { type: 'string' },
    rationale: { type: 'string' },
  },
} as const

export async function proposeAdIdea(input: {
  readonly studio: string
  readonly areas: readonly string[]
  readonly posts: readonly { id: string; caption: string; mediaType: string; timestamp: string }[]
  readonly dailyCapTl: number
  readonly campaignCapTl: number
  readonly results: string // one line of the last 30 days, or '(henüz reklam verisi yok)'
}): Promise<{ ok: true; idea: AdIdea } | { ok: false; reason: 'not_configured' | 'failed' | 'unreadable' }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'not_configured' }
  const posts = input.posts.map((p) => `- id=${p.id} · ${p.mediaType} · ${p.timestamp.slice(0, 10)} · "${p.caption.replace(/\s+/g, ' ').slice(0, 160)}"`).join('\n')
  const prompt = `Kadınlara özel bir pilates & fitness stüdyosunun Meta reklam planlayıcısısın. Tek bir kampanya taslağı öner. Reklama tıklayan WhatsApp'a düşer; orada AI resepsiyonist tek fiyat listesinden cevaplar.

STÜDYO (sahibinin bilgi kartı — tek bilgi kaynağın):
"""
${input.studio}
"""
BÖLGE: ${input.areas.join(', ') || '(tanımlı değil)'}
SON REKLAM SONUÇLARI (30 gün): ${input.results}

INSTAGRAM GÖNDERİLERİ (reklam görseli bunlardan BİRİ olacak; igMediaId bu listedeki id'lerden biri olmalı):
${posts || '(gönderi yok)'}

TAVANLAR — KESİN (aşarsan taslak reddedilir): günlük bütçe en fazla ${input.dailyCapTl} TL; dailyBudgetTl × days en fazla ${input.campaignCapTl} TL.

KURALLAR:
- name: kısa, Türkçe, kampanyayı anlatan (ör. "12 Aylık Fitness · Kasım").
- Güncel kampanyayı (bilgi kartındaki) öne çıkaran, o kampanyaya en uygun gönderiyi seç. Videolu gönderiler genelde daha iyi çalışır.
- İlk kampanyalarda temkinli ol: kısa süre (7–14 gün) ve tavanın altında bütçe; ilk haftanın sonunda ölçülecek.
- Yaş: hizmetin kitlesine göre (genelde 25–50). Yarıçap: 5–10 km (stüdyo Çayırova'da).
- rationale: 2–3 cümle, neden bu gönderi, bu bütçe, bu süre. Sahibine yazıyorsun; sade Türkçe, rakam uydurma.`
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      console.error('[ad-planner] model call failed', res.status, (await res.text().catch(() => '')).slice(0, 300))
      return { ok: false, reason: 'failed' }
    }
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
    const text = data.content?.find((b) => b.type === 'text')?.text
    if (!text) return { ok: false, reason: 'unreadable' }
    const idea = JSON.parse(text) as AdIdea
    if (!input.posts.some((p) => p.id === idea.igMediaId)) return { ok: false, reason: 'unreadable' } // a post it invented
    return { ok: true, idea }
  } catch (e) {
    console.error('[ad-planner]', (e as Error)?.message ?? e)
    return { ok: false, reason: 'failed' }
  }
}
