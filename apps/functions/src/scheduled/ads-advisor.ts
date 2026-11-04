// IG-5b (2026-11-04) — the AI's weekly look at each running campaign. It may ASK for one change
// (pause / budget / end date) or nothing. The ask lands as a pending request on the owner's card; the
// domain refuses any ask over the caps, and nothing reaches Meta until the owner approves.
//
// What the model sees: the campaign's own numbers (days, budget, spend, impressions, clicks, WhatsApp
// conversations started) and the caps. No member data.
import * as logger from 'firebase-functions/logger'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5-5'

export interface AdviceInput {
  readonly name: string
  readonly startDate: string
  readonly endDate: string
  readonly today: string
  readonly dailyBudgetTl: number
  readonly spentTl: number
  readonly impressions: number
  readonly clicks: number
  readonly messages: number
  readonly otherCampaigns: string // one line per other campaign, for comparison
  readonly dailyCapTl: number
  readonly campaignCapTl: number
}

export type Advice =
  | { readonly action: 'none' }
  | { readonly action: 'pause'; readonly rationale: string }
  | { readonly action: 'budget'; readonly dailyBudgetTl: number; readonly rationale: string }
  | { readonly action: 'end_date'; readonly endDate: string; readonly rationale: string }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'dailyBudgetTl', 'endDate', 'rationale'],
  properties: {
    action: { type: 'string', enum: ['none', 'pause', 'budget', 'end_date'] },
    dailyBudgetTl: { type: 'integer' },
    endDate: { type: 'string' },
    rationale: { type: 'string' },
  },
} as const

/** Pure: the model's JSON → an Advice, or 'none' when it is not usable. */
export function parseAdvice(raw: unknown): Advice {
  const r = raw as { action?: string; dailyBudgetTl?: number; endDate?: string; rationale?: string }
  const why = String(r?.rationale ?? '').trim()
  if (!why) return { action: 'none' }
  if (r.action === 'pause') return { action: 'pause', rationale: why }
  if (r.action === 'budget' && Number.isInteger(r.dailyBudgetTl) && (r.dailyBudgetTl as number) > 0) return { action: 'budget', dailyBudgetTl: r.dailyBudgetTl as number, rationale: why }
  if (r.action === 'end_date' && /^\d{4}-\d{2}-\d{2}$/.test(String(r.endDate))) return { action: 'end_date', endDate: String(r.endDate), rationale: why }
  return { action: 'none' }
}

export async function adviseCampaign(input: AdviceInput): Promise<Advice> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { action: 'none' }
  const prompt = `Kadınlara özel bir pilates & fitness stüdyosunun Meta reklamlarını haftalık değerlendiriyorsun. Reklama tıklayan WhatsApp'a yazar; amaç WhatsApp konuşması ve sonunda üyelik.

KAMPANYA: ${input.name}
Tarih: ${input.startDate} – ${input.endDate} (bugün ${input.today})
Günlük bütçe: ${input.dailyBudgetTl} TL · Şimdiye kadar harcanan: ${input.spentTl} TL
Gösterim: ${input.impressions} · Tıklama: ${input.clicks} · WhatsApp konuşması: ${input.messages}
Diğer kampanyalar (karşılaştırma için): ${input.otherCampaigns || '(yok)'}

TAVANLAR — KESİN: günlük en fazla ${input.dailyCapTl} TL; günlük bütçe × kampanyanın TOPLAM gün sayısı en fazla ${input.campaignCapTl} TL.

En fazla BİR değişiklik öner ya da hiçbir şey önerme:
- "none": veri az (ör. 3 günden kısa) ya da kampanya makul gidiyor. Emin değilsen none.
- "pause": para harcanıyor ama konuşma gelmiyor (ör. 1.000 TL'den fazla harcama, çok az konuşma).
- "budget": iyi gidiyor ve tavan izin veriyor → artır; ya da pahalı → azalt. dailyBudgetTl = yeni günlük TL.
- "end_date": iyi gidiyor ve süre bitmek üzere → uzat (tavanı aşma). endDate = YYYY-MM-DD.
rationale: sahibine 1–2 cümle, sade Türkçe, yukarıdaki gerçek rakamlarla. Rakam uydurma. Kullanılmayan alanlar: dailyBudgetTl 0, endDate "".`
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      logger.warn('ads-advisor: model call failed', { status: res.status })
      return { action: 'none' }
    }
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
    const text = data.content?.find((b) => b.type === 'text')?.text
    return text ? parseAdvice(JSON.parse(text)) : { action: 'none' }
  } catch (e) {
    logger.warn('ads-advisor: failed', { error: (e as Error)?.message })
    return { action: 'none' }
  }
}
