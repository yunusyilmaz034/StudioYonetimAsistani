import 'server-only'

import { CARDIO_MACHINES, type CardioMachine } from '@studio/core'

// A photo of a cardio machine's screen as the DATA SOURCE for a session (owner, 2026-10-13).
//
// The member finishes on the treadmill, photographs the summary, and the session is in her day. She
// is NOT asked to confirm what was read (*"kullanıcıya sorma bir daha"*): the line shows the figures
// and she can remove it, which is a cheaper correction than a form in front of every entry.
//
// That decision is why this call does not use the briefing's cheap model: there is no human between
// the reading and the record. It is also why the rule below is "null, never a guess" — a missing
// figure is filled in by the domain's own arithmetic, a wrong one is believed.
//
// The image is NEVER STORED. It is read once, here, and discarded. A gym photo can contain a
// bystander or a reflection; nothing but four numbers and a machine type survives this function.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5-5'

export interface CardioReading {
  readonly machine: CardioMachine
  readonly minutes: number | null
  readonly kcal: number | null
  readonly distanceKm: number | null
}
export type CardioReadResult =
  | { readonly ok: true; readonly value: CardioReading }
  | { readonly ok: false; readonly reason: 'not_configured' | 'unreadable' | 'failed' }

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'machine', 'minutes', 'kcal', 'distanceKm'],
  properties: {
    readable: { type: 'boolean' },
    machine: { type: 'string', enum: [...CARDIO_MACHINES] },
    minutes: nullableNumber,
    kcal: nullableNumber,
    distanceKm: nullableNumber,
  },
}

const PROMPT = `Bu, bir spor salonundaki kardiyo aletinin (koşu bandı, eliptik, bisiklet, merdiven, kürek) ekranının fotoğrafıdır. Görevin SADECE ekranda yazan antrenman özetini okumak.

Kurallar:
- minutes: geçen süre, DAKİKA cinsinden ondalıklı sayı. "22:30" → 22.5. "1:05:00" → 65. Geri sayan kalan süreyi DEĞİL, geçen/toplam süreyi al; hangisi olduğu anlaşılmıyorsa null.
- kcal: ekranda yazan yakılan kalori (kcal / cal / kalori). "kcal/h", "cal/hr" gibi SAATLİK HIZ değerlerini ASLA alma. Yoksa null.
- distanceKm: mesafe, kilometre. Mil yazıyorsa 1,609 ile çarp. Metre yazıyorsa 1000'e böl. Yoksa null.
- machine: aletin türü — treadmill (koşu bandı), elliptical (eliptik), bike (bisiklet), stairs (merdiven), rower (kürek). Emin değilsen "other".
- Bir değer ekranda yoksa ya da okunmuyorsa null bırak. ASLA tahmin etme, hesaplama, türetme.
- Hız, eğim, nabız, seviye, watt gibi diğer değerleri yok say.
- Fotoğraftaki insanlar ya da ortam hakkında hiçbir şey yazma.
- Fotoğraf bir kardiyo aleti ekranı değilse ya da hiçbir değer okunmuyorsa readable=false ver.`

export function cardioPhotoConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const MEDIA = ['image/jpeg', 'image/png', 'image/webp'] as const
export type CardioPhotoMedia = (typeof MEDIA)[number]
export const isCardioPhotoMedia = (v: string): v is CardioPhotoMedia => (MEDIA as readonly string[]).includes(v)

export async function readCardioPhoto(base64: string, mediaType: CardioPhotoMedia): Promise<CardioReadResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'not_configured' }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        // Transcription, not reasoning — and she is standing next to the machine waiting.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.error('[cardio-photo] model call failed', res.status)
      return { ok: false, reason: 'failed' }
    }
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
    const text = data.content?.find((b) => b.type === 'text')?.text
    if (!text) return { ok: false, reason: 'unreadable' }
    const raw = JSON.parse(text) as Record<string, unknown>
    if (raw.readable === false) return { ok: false, reason: 'unreadable' }

    // A model that answers `0` for a figure it could not find would be believed. Zero is not a
    // reading of anything on a finished session — treat it as absent.
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
    const machine = (CARDIO_MACHINES as readonly string[]).includes(String(raw.machine)) ? (raw.machine as CardioMachine) : 'other'
    const value: CardioReading = { machine, minutes: num(raw.minutes), kcal: num(raw.kcal), distanceKm: num(raw.distanceKm) }
    // Nothing to build a session from: no time and no calories.
    if (value.minutes === null && value.kcal === null) return { ok: false, reason: 'unreadable' }
    return { ok: true, value }
  } catch (err) {
    console.error('[cardio-photo]', (err as Error)?.message ?? err)
    return { ok: false, reason: 'failed' }
  }
}
