// IG-2c — the AI's edit decision. It sees a few small frames of every raw clip, what was said in them
// (transcribed on our server) and the shot card. It never sees the video. It returns a proposal; the
// domain (`normalizeEditPlan`) makes it safe to render, so a bad answer cannot produce a bad file.
import type { AiEditProposal, ContentPost, MusicTrack, TranscriptLine } from '@studio/core'
import { lineId } from '@studio/core'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5-5'

export interface PlannerClip {
  readonly slot: number
  readonly seconds: number
  readonly frames: readonly { readonly at: number; readonly jpegBase64: string }[]
}

export interface PlannerResult extends AiEditProposal {
  readonly caption: string
  readonly hashtags: readonly string[]
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segments', 'hook', 'coverAt', 'musicTrackId', 'subtitles', 'lineFixes', 'notes', 'caption', 'hashtags'],
  properties: {
    segments: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['slot', 'from', 'to'], properties: { slot: { type: 'integer' }, from: { type: 'number' }, to: { type: 'number' } } },
    },
    hook: { type: 'string' },
    coverAt: { type: 'number' },
    musicTrackId: { type: ['string', 'null'] },
    subtitles: { type: 'boolean' },
    lineFixes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'unsure'], properties: { id: { type: 'string' }, text: { type: 'string' }, unsure: { type: 'boolean' } } },
    },
    notes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['level', 'text'], properties: { level: { type: 'string', enum: ['ok', 'warn'] }, text: { type: 'string' } } },
    },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
} as const

export function plannerPrompt(post: Pick<ContentPost, 'title' | 'shotCard' | 'caption' | 'hashtags'>, clips: readonly PlannerClip[], transcript: readonly TranscriptLine[], tracks: readonly MusicTrack[], areas: readonly string[]): string {
  const card = post.shotCard.clips.map((c, i) => `  slot ${i}: ${c.seconds} sn planlı · ${c.angle} · ${c.what}`).join('\n')
  const raw = clips.map((c) => `  slot ${c.slot}: ${c.seconds.toFixed(1)} sn · kareler: ${c.frames.map((f) => `${f.at.toFixed(1)} sn`).join(', ')}`).join('\n')
  const speech = transcript.length ? transcript.map((t) => `  [${lineId(t.slot, t.index)}] slot ${t.slot} · ${t.start.toFixed(1)}–${t.end.toFixed(1)} sn: ${t.text}`).join('\n') : '  (konuşma yok)'
  const music = tracks.filter((t) => t.active).map((t) => `  ${t.id}: ${t.name} · ${t.mood} · ${t.seconds} sn`).join('\n') || '  (kütüphane boş)'
  return `Kadınlara özel bir pilates & fitness stüdyosunun Instagram Reels kurgucususun. Ekip çekim kartına göre ham klipleri çekti. Ekte her klipten sırayla birkaç küçük kare var (klip ve saniye etiketli).

GÖNDERİ: ${post.title}
ÇEKİM KARTI (slot = klip sırası):
${card}
İlk 3 sn yazısı (kanca): ${post.shotCard.hook || '(yok)'}
Müzik notu: ${post.shotCard.music || '(yok)'}
HAM KLİPLER:
${raw}
KONUŞMA (sunucuda yazıya döküldü; [id] ile):
${speech}
MÜZİK KÜTÜPHANESİ (yalnız bunlardan seç ya da null):
${music}
PLANLANAN AÇIKLAMA:
"""${post.caption}"""
ETİKETLER: ${post.hashtags.map((h) => `#${h}`).join(' ') || '(yok)'}
BÖLGE: ${areas.join(', ')}

Kurgu kuralları:
- segments: sırayla oynatılacak parçalar {slot, from, to} (o klibin saniyesi). Toplam 15–45 sn ideal, en fazla 90. İlk parça en çarpıcı an olsun (kanca). Konuşmayı cümle ortasında kesme. Bulanık, karanlık, sallantılı yerleri at.
- hook: ilk 3 sn ekranda yazı, kısa (en fazla 6 kelime). Çekim kartındaki kancayı koruyabilir ya da iyileştirebilirsin.
- coverAt: kapak olacak an, ÇIKAN videonun saniyesi.
- musicTrackId: konuşma ağırlıklıysa sakin bir parça ya da null; hareketliyse uygun tempoda.
- subtitles: konuşma varsa true.
- lineFixes: yazıya dökülmüş her satırı Türkçe yazım kurallarına göre düzelt (id aynı). Duyduğundan emin değilsen unsure=true. Uydurma.
- notes: en fazla 5 kısa madde (ok = yerinde, warn = dikkat: eksik klip, karanlık, tanınabilir yüz → izin kutusunu hatırlat).
- caption: açıklamayı kurguya göre son hâline getir; aynı ses tonu, kısa, emoji ölçülü, sonunda deneme dersi çağrısı (DM ya da WhatsApp). Fiyat yazma. En fazla 1.500 karakter.
- hashtags: 8–15, '#' olmadan, Türkçe karakterleri koru.`
}

export function parseProposal(text: string): PlannerResult | null {
  try {
    const r = JSON.parse(text) as Partial<PlannerResult>
    if (!Array.isArray(r.segments)) return null
    return {
      segments: r.segments.map((s) => ({ slot: Number(s.slot), from: Number(s.from), to: Number(s.to) })),
      hook: String(r.hook ?? ''),
      coverAt: Number(r.coverAt ?? 0),
      musicTrackId: r.musicTrackId == null ? null : String(r.musicTrackId),
      subtitles: Boolean(r.subtitles),
      lineFixes: (r.lineFixes ?? []).map((l) => ({ id: String(l.id), text: String(l.text ?? ''), unsure: Boolean(l.unsure) })),
      notes: (r.notes ?? []).map((n) => ({ level: n.level === 'warn' ? ('warn' as const) : ('ok' as const), text: String(n.text ?? '') })),
      caption: String(r.caption ?? '').slice(0, 1800),
      hashtags: (r.hashtags ?? []).map(String).slice(0, 20),
    }
  } catch {
    return null
  }
}

export async function planEdit(key: string, prompt: string, clips: readonly PlannerClip[]): Promise<PlannerResult> {
  const images = clips.flatMap((c) =>
    c.frames.flatMap((f) => [
      { type: 'text', text: `slot ${c.slot} · ${f.at.toFixed(1)} sn` },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.jpegBase64 } },
    ]),
  )
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [...images, { type: 'text', text: prompt }] }],
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
  const out = parseProposal(data.content?.find((b) => b.type === 'text')?.text ?? '')
  if (!out) throw new Error('model answer unreadable')
  return out
}
