import 'server-only'

// The scale's printout as the DATA SOURCE for a measurement (owner, 2026-08-05).
//
// Reception scans the Tanita's PDF, the model reads the numbers off it, the form is PRE-FILLED, and a
// human still presses Kaydet. That last part is the whole design: the model never writes a
// measurement, it only saves typing. A misread digit is caught by the person holding the paper,
// because the numbers she is looking at are the numbers on her screen.
//
// The PDF is NEVER STORED. It is read once, in this function, and discarded — it is a data source, not
// an attachment. No bucket, no retention window, nothing to erase later.
//
// ⚠️ PII: unlike every other AI call in this product, the payload here CANNOT be tokenised — the
// member's name is printed on the sheet and we are sending the sheet. The prompt forbids returning it
// and nothing but numbers is ever kept, but the document itself does leave. This is a deliberate
// exception, recorded as OR-27; the alternative is typing every reading by hand.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

// Reading a number wrong is a defect that lands in a member's record, so this one call does not use
// the cheap model the daily briefing uses. Volume is a handful of readings a week — correctness wins.
const MODEL = 'claude-opus-5'

export const PDF_METRIC_KEYS = [
  'weightKg',
  'idealWeightKg',
  'leanMassKg',
  'leanMassPercent',
  'muscleKg',
  'musclePercent',
  'waterKg',
  'waterPercent',
  'fatKg',
  'fatPercent',
  'bmi',
  'bmr',
  'visceralFat',
] as const
export type PdfMetricKey = (typeof PDF_METRIC_KEYS)[number]

export interface ParsedMeasurement {
  readonly takenOn: string | null // LocalDate (YYYY-MM-DD) if the sheet prints one
  readonly metrics: Readonly<Partial<Record<PdfMetricKey, number>>>
  // The one circumference the RD-545 prints itself ("Antropometrik İnceleme → Bel (cm) 75"). Not a
  // new field — the form has always had Çevre ölçüleri, and the sheet was answering it while we left
  // it blank. Everything else in that box is a RATIO (Bel/Kalça 0.78, Bel/Boy 0.45) and is refused.
  readonly waistCm: number | null
}
export type ParseResult =
  | { readonly ok: true; readonly value: ParsedMeasurement }
  | { readonly ok: false; readonly reason: 'not_configured' | 'unreadable' | 'failed' }

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'takenOn', 'waistCm', ...PDF_METRIC_KEYS],
  properties: {
    readable: { type: 'boolean' },
    takenOn: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    waistCm: nullableNumber,
    ...Object.fromEntries(PDF_METRIC_KEYS.map((k) => [k, nullableNumber])),
  },
}

// Written against what this studio's Tanita RD-545 actually prints. The two rules that matter are the
// parenthesised NORMAL RANGE (which must never be mistaken for the reading) and multi-column history
// sheets (where only the newest column is this measurement).
const PROMPT = `Bu bir vücut analiz tartısının (Tanita) çıktısıdır. Görevin SADECE üzerindeki sayıları okumak.

Okuma kuralları:
- Her etiketin YANINDAKİ İLK değeri al. Parantez içindeki aralıklar (ör. "59.41kg (53.09~65.73kg)") NORMAL ARALIKTIR, ölçüm değildir — ASLA alma.
- "42.93kg / 63.7%" biçiminde ikili değer varsa: ilki kilogram, ikincisi yüzdedir.
- Belgede birden fazla tarihli ölçüm satırı/sütunu varsa (ör. "Fark Analizi" tablosu), YALNIZCA EN
  GÜNCEL tarihli olanı oku. Grafiklerdeki eski noktaları ve "Fark" sütunlarını ASLA alma.
- "E | S" biçiminde ikili skor varsa (ör. "BMI  20.8 / 21.7") İKİNCİ değer güncel olandır.
- Ondalık ayırıcı virgülse noktaya çevir (62,4 → 62.4).
- Bir alan belgede yoksa null bırak. ASLA tahmin etme, hesaplama, türetme.
- Üyenin adını, doğum tarihini veya kimlik bilgisini ASLA döndürme. Yanıtta yalnızca sayılar olacak.
- Belge okunamıyorsa (bulanık, boş, tartı çıktısı değil) readable=false ver ve tüm alanları null bırak.

Alan eşlemesi:
- Kilo / Ağırlık → weightKg
- İdeal Kilo → idealWeightKg
- Yağsız Kütle → leanMassKg (kg) ve leanMassPercent (%)
- Kas / Kas Kütlesi → muscleKg (kg) ve musclePercent (%)
- Sıvı / Su / Vücut Suyu → waterKg (kg) ve waterPercent (%)
- Yağ / Vücut Yağı → fatKg (kg) ve fatPercent (%)
- BMI / VKİ / Vücut Kitle İndeksi → bmi
- BMR / Bazal Metabolizma → bmr
- Visseral / İç Yağlanma → visceralFat
- Bel (cm) → waistCm. SADECE santimetre cinsinden mutlak değeri al. "Bel / Kalça 0.78", "Bel / Boy
  0.45" gibi ORAN değerlerini ASLA waistCm sanma; oran varsa ve cm yoksa null bırak.
- takenOn: çıktının ölçüm tarihi, YYYY-MM-DD biçiminde. Yoksa null.`

export function measurementPdfConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function parseMeasurementPdf(base64Pdf: string): Promise<ParseResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'not_configured' }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        // Reading printed numbers is transcription, not reasoning — deep thinking here buys nothing
        // and only adds latency to someone standing at the desk with a member in front of her.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
      // Reception is waiting on this with a member at the desk. If it has not answered in 45s the
      // honest thing is "okunamadı" and the manual fields, not a spinner that never stops.
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return { ok: false, reason: 'failed' }

    const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
    const text = data.content?.find((b) => b.type === 'text')?.text
    if (!text) return { ok: false, reason: 'unreadable' }

    const raw = JSON.parse(text) as Record<string, unknown>
    if (raw.readable === false) return { ok: false, reason: 'unreadable' }

    const metrics: Partial<Record<PdfMetricKey, number>> = {}
    for (const k of PDF_METRIC_KEYS) {
      const v = raw[k]
      // A model that answers `0` for a field it could not find would silently zero a real reading —
      // a body has no 0 kg of muscle. Anything non-positive is treated as "not on the sheet".
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) metrics[k] = v
    }
    // Every field null means the model looked and found nothing — that is unreadable, not an empty
    // measurement. Never hand the desk a form it thinks was filled in.
    if (Object.keys(metrics).length === 0) return { ok: false, reason: 'unreadable' }

    const d = typeof raw.takenOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.takenOn) ? raw.takenOn : null
    // A waist ratio (0.78) slipping through as a circumference would put "Bel 0.78 cm" on the record.
    // No human waist is under 30 cm or over 250, so the band refuses one without pretending to judge.
    const w = raw.waistCm
    const waistCm = typeof w === 'number' && Number.isFinite(w) && w >= 30 && w <= 250 ? w : null
    return { ok: true, value: { takenOn: d, metrics, waistCm } }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
