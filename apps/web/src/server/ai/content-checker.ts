import 'server-only'

// IG-2b (2026-11-04) — the AI's last look before the owner approves. It sees a few frames of the file
// (taken in the browser — the video itself never leaves our storage), the shot card and the planned
// caption. It returns short notes (what is fine, what to watch) and the FINAL caption + hashtags.
// It never decides anything: the owner approves, the domain enforces Instagram's limits.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5-5'

export interface CheckInput {
  readonly format: 'reels' | 'photo' | 'story'
  readonly title: string
  readonly shotCard: { readonly clips: readonly { seconds: number; angle: string; what: string }[]; readonly hook: string; readonly music: string }
  readonly caption: string
  readonly hashtags: readonly string[]
  readonly areas: readonly string[]
  readonly kind: 'video' | 'image'
  readonly seconds: number | null
  readonly width: number
  readonly height: number
  readonly framesJpegBase64: readonly string[] // 1–6 small frames, in order
}

export interface CheckResult {
  readonly notes: readonly { level: 'ok' | 'warn'; text: string }[]
  readonly caption: string
  readonly hashtags: readonly string[]
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes', 'caption', 'hashtags'],
  properties: {
    notes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['level', 'text'], properties: { level: { type: 'string', enum: ['ok', 'warn'] }, text: { type: 'string' } } },
    },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
} as const

export async function checkContentMedia(input: CheckInput): Promise<CheckResult | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || input.framesJpegBase64.length === 0) return null
  const shape = input.kind === 'video' ? `video, ${input.seconds} sn, ${input.width}×${input.height}` : `fotoğraf, ${input.width}×${input.height}`
  const clips = input.shotCard.clips.map((c, i) => `${i + 1}) ${c.seconds} sn · ${c.angle} · ${c.what}`).join('\n')
  const text = `Kadınlara özel bir pilates & fitness stüdyosunun Instagram editörüsün. Ekip çekim kartına göre çekti ve yükledi. Ekte dosyadan sırayla ${input.framesJpegBase64.length} kare var.

GÖNDERİ: ${input.title} · ${input.format} · ${shape}
ÇEKİM KARTI:
${clips}
İlk 3 sn yazısı (kanca): ${input.shotCard.hook || '(yok)'}
Müzik notu: ${input.shotCard.music || '(yok)'}
PLANLANAN AÇIKLAMA:
"""${input.caption}"""
ETİKETLER: ${input.hashtags.map((h) => `#${h}`).join(' ') || '(yok)'}
BÖLGE: ${input.areas.join(', ')}

1) notes: en fazla 5 kısa madde, sade Türkçe. "ok" = yerinde olan (ör. "Dikey 9:16, 31 sn"), "warn" = dikkat (ör. kanca yazısı görünmüyor, karanlık, yatay çekilmiş, çekim kartındaki bir klip yok, kadraja tanınabilir yüz girmiş — izin kutusunu hatırlat). Görmediğin şeyi uydurma; karelerden emin olamıyorsan söyleme.
2) caption: planlanan açıklamayı videoya göre son hâline getir. Aynı ses tonu, kısa, emoji ölçülü, sonunda deneme dersi çağrısı (DM ya da WhatsApp). Fiyat yazma. En fazla 1.500 karakter.
3) hashtags: 8–15 etiket, '#' olmadan; bölge semtleri + pilates/fitness + kadınlara özel. Türkçe karakterleri koru.`
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              ...input.framesJpegBase64.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
              { type: 'text', text },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      console.error('[content-checker] model call failed', res.status, (await res.text().catch(() => '')).slice(0, 300))
      return null
    }
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
    const out = data.content?.find((b) => b.type === 'text')?.text
    if (!out) return null
    const r = JSON.parse(out) as CheckResult
    return {
      notes: (r.notes ?? []).slice(0, 5).map((n) => ({ level: n.level === 'warn' ? 'warn' : 'ok', text: String(n.text).slice(0, 240) })),
      caption: String(r.caption ?? '').slice(0, 1800),
      hashtags: (r.hashtags ?? []).map(String).slice(0, 20),
    }
  } catch (e) {
    console.error('[content-checker]', (e as Error)?.message ?? e)
    return null
  }
}
