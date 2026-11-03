import 'server-only'

// IG-2a (2026-11-03) — the weekly Instagram plan. The model proposes 3–5 posts with a shot card the
// studio can FILM (owner: "ne olması gerektiğini, nasıl çekilmesini gerektiğini söyle, biz çekelim").
// It proposes; it never publishes — the result lands as `suggested` posts the owner approves.
//
// What the model sees: the studio's own knowledge card (identity, basics, campaign — written by the
// owner for the AI already), the area names to be found by, and the titles of recent posts so it does
// not repeat itself. NO member data, no prices (a price in a caption goes stale the day it changes;
// prices are answered in DM from one list — OR-129).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5-5'

export interface PlannedIdea {
  readonly dayIndex: number // 0 = Monday
  readonly time: string // 'HH:MM', Europe/Istanbul
  readonly format: 'reels' | 'photo' | 'story'
  readonly title: string
  readonly clips: readonly { seconds: number; angle: string; what: string }[]
  readonly hook: string
  readonly notes: string
  readonly music: string
  readonly caption: string
  readonly hashtags: readonly string[]
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posts'],
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dayIndex', 'time', 'format', 'title', 'clips', 'hook', 'notes', 'music', 'caption', 'hashtags'],
        properties: {
          dayIndex: { type: 'integer' },
          time: { type: 'string' },
          format: { type: 'string', enum: ['reels', 'photo', 'story'] },
          title: { type: 'string' },
          clips: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['seconds', 'angle', 'what'],
              properties: { seconds: { type: 'integer' }, angle: { type: 'string' }, what: { type: 'string' } },
            },
          },
          hook: { type: 'string' },
          notes: { type: 'string' },
          music: { type: 'string' },
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

export function contentPlannerConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

function prompt(input: { studio: string; areas: readonly string[]; weekLabel: string; recentTitles: readonly string[]; count: number }): string {
  return `Kadınlara özel bir pilates & fitness stüdyosunun Instagram içerik planlayıcısısın. ${input.weekLabel} haftası için ${input.count} gönderi öner.

STÜDYO (sahibinin kendi yazdığı bilgi kartı — tek bilgi kaynağın bu; uydurma):
"""
${input.studio}
"""

BÖLGE (stüdyonun bulunmak istediği semtler): ${input.areas.join(', ') || '(tanımlı değil)'}
SON GÖNDERİLER (tekrar etme): ${input.recentTitles.join(' · ') || '(yok)'}

KURALLAR:
- Çekimi stüdyo kendisi telefonla yapacak. Her gönderi için ÇEKİLEBİLİR bir çekim kartı yaz: klip klip saniye, açı, kadrajda ne olacağı. Reels 2–6 klip, toplam 12–35 sn; fotoğraf 1 kare (seconds=1); hikâye 1–3 klip.
- hook = ilk 3 saniyede ekranda yazacak kısa cümle (en fazla 60 karakter; fotoğrafta boş bırakabilirsin).
- notes = telefon dik (9:16), ışık, dikkat edilecek tek pratik şey. Kısa.
- music = ruh hali + kaynak, ör. "sakin · Meta Sound Collection". Yalnız telifsiz kaynak öner; popüler şarkı adı YAZMA.
- caption: Türkçe, sıcak, 2–4 cümle, sonunda bir davet (DM / yer ayırt). FİYAT YAZMA. Üye adı YAZMA. "En iyi", "1 numara" gibi kanıtlanamaz iddia YOK. Emoji en fazla 2.
- hashtags: 8–15 adet, # işaretsiz. Mutlaka bölge semtlerinden 3–5 tanesini kullan (ör. "çayırovapilates", "gebzefitness"). Türkçe karakterleri koru.
- Yüzü görünen biri gerekiyorsa çekim kartında "(izinli üye)" diye belirt; mümkünse yüzsüz kadraj öner.
- Gönderileri haftaya yay (dayIndex 0=Pazartesi … 6=Pazar), saatler 08:00–21:00 arası, aynı güne ikiden fazla koyma.
- Çeşitlilik: en az bir yeni başlayana güven veren, bir kampanya/üyelik, bir stüdyo atmosferi gönderisi.`
}

export type PlanResult = { ok: true; ideas: readonly PlannedIdea[] } | { ok: false; reason: 'not_configured' | 'failed' | 'unreadable' }

export async function planInstagramWeek(input: {
  studio: string
  areas: readonly string[]
  weekLabel: string
  recentTitles: readonly string[]
  count: number
}): Promise<PlanResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'not_configured' }
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt(input) }] }],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      console.error('[content-planner] model call failed', res.status, (await res.text().catch(() => '')).slice(0, 300))
      return { ok: false, reason: 'failed' }
    }
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
    const text = data.content?.find((b) => b.type === 'text')?.text
    if (!text) return { ok: false, reason: 'unreadable' }
    const raw = JSON.parse(text) as { posts?: PlannedIdea[] }
    const ideas = (raw.posts ?? []).filter((p) => p && typeof p.title === 'string' && Array.isArray(p.clips)).slice(0, 6)
    return ideas.length ? { ok: true, ideas } : { ok: false, reason: 'unreadable' }
  } catch (e) {
    console.error('[content-planner]', (e as Error)?.message ?? e)
    return { ok: false, reason: 'failed' }
  }
}
