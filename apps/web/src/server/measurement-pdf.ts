import 'server-only'

import { getDocumentProxy } from 'unpdf'

// The scale's printout as the DATA SOURCE for a measurement (owner, 2026-08-05, OR-27) — read on OUR
// server, with no AI (owner, 2026-11-12, OR-134).
//
// The studio's Tanita prints through the PERFECTO software, which writes a real text PDF
// (wkhtmltopdf): every figure sits next to its label as text. So the sheet is read the way a person
// reads it — label, then the first number after it — and nothing leaves the building. The 2026-08
// version sent the whole sheet (name + body composition) to a model abroad; that was switched off for
// KVKK on 2026-11-10 and is replaced by this.
//
// The design is unchanged: the form is PRE-FILLED and a human still presses Kaydet. A sheet this reader
// does not recognise (another device, a scan, a photo) is a plain "okunamadı" and the desk types the
// figures — it never guesses. The PDF is never stored, and the member's name, though on the sheet, is
// never read into any field.

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
  readonly takenOn: string | null // LocalDate (YYYY-MM-DD)
  readonly metrics: Readonly<Partial<Record<PdfMetricKey, number>>>
  readonly waistCm: number | null
}
export type ParseResult =
  | { readonly ok: true; readonly value: ParsedMeasurement }
  | { readonly ok: false; readonly reason: 'unreadable' | 'failed' }

const N = String.raw`(\d+(?:[.,]\d+)?)`
// "47.98kg / 74.5%" — the reading; the parenthesised range after it is the NORMAL RANGE and is never
// matched, because every pattern stops at the first number pair after the label.
const KG_PCT = String.raw`\s+${N}\s*kg\s*/\s*${N}\s*%`
const num = (s: string | undefined): number | null => {
  if (s == null) return null
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * PURE. The sheet's text, one printed line per entry, top to bottom → the figures. Exported for tests;
 * the lines are what {@link readMeasurementPdf} rebuilds from the PDF's text positions.
 */
export function parseTanitaLines(lines: readonly string[]): ParseResult {
  const text = lines.join('\n')
  const first = (re: RegExp): RegExpMatchArray | null => text.match(re)
  const metrics: Partial<Record<PdfMetricKey, number>> = {}
  const put = (k: PdfMetricKey, v: number | null) => {
    if (v != null && metrics[k] == null) metrics[k] = v
  }
  const pair = (label: string, kg: PdfMetricKey, pct: PdfMetricKey) => {
    const m = first(new RegExp(label + KG_PCT, 'mu'))
    put(kg, num(m?.[1]))
    put(pct, num(m?.[2]))
  }

  // Header row: "<name …> Kadın Standart 34 64.4 162.0 24.5 (20 ~ 25)" — age, weight, height, BMI and
  // the BMI range close the line. Read from the RIGHT so the name, whatever it is, is never touched.
  const head = first(
    /\s(\d{1,3})\s+(\d{2,3}(?:[.,]\d+)?)\s+(\d{2,3}(?:[.,]\d+)?)\s+(\d{1,2}[.,]\d+)\s*\(\s*\d+\s*~\s*\d+\s*\)\s*$/mu,
  )
  put('weightKg', num(head?.[2]))
  put('bmi', num(head?.[4]))
  // The BMI box spells the arithmetic out: "(64.4) /(162.0)* (162.0)" — the weight again, if the header
  // row was laid out differently.
  put(
    'weightKg',
    num(
      first(
        /\(\s*(\d{2,3}(?:[.,]\d+)?)\s*\)\s*\/\s*\(\s*\d{2,3}(?:[.,]\d+)?\s*\)\s*\*/u,
      )?.[1],
    ),
  )
  put('bmi', num(first(/(?:^|\s)BMI\s+(\d{1,2}[.,]\d+)/mu)?.[1]))

  put(
    'idealWeightKg',
    num(first(new RegExp(String.raw`İdeal Kilo\s+${N}\s*kg`, 'u'))?.[1]),
  )
  // "Yumuşak Yağsız Kütle" is a different quantity printed further down; it must not answer "Yağsız Kütle".
  pair(String.raw`(?<!Yumuşak\s)Yağsız Kütle`, 'leanMassKg', 'leanMassPercent')
  // Bare labels, anchored on a word boundary: "Kas kg 25.55" (segmental trunk), "İskeletsel Kaslar",
  // "Hücre İçi Sıvı 20.00kg" and "Yağ kg 9.23" all lack the "kg / %" pair and cannot match.
  pair(String.raw`(?:^|\s)Kas`, 'muscleKg', 'musclePercent')
  pair(String.raw`(?:^|\s)Sıvı`, 'waterKg', 'waterPercent')
  pair(String.raw`(?:^|\s)Yağ`, 'fatKg', 'fatPercent')

  // "1,429 kcal" — a THOUSANDS separator here, not a decimal one: a basal rate is a whole number of kcal.
  const bmr = first(/Bazal Metabolizma Hızı\s+(\d{1,2}[.,]\d{3}|\d{3,4})\s*kcal/u)?.[1]
  put('bmr', bmr ? num(bmr.replace(/[.,]/, '')) : null)
  // "İç Yağlanma 7.5 (1 ~ 13)" — not "İç Yağlanma Oranı" (a gauge label with no number after it).
  put('visceralFat', num(first(new RegExp(String.raw`İç Yağlanma\s+${N}`, 'u'))?.[1]))

  // Every field missing means this is not the sheet we know — unreadable, never an empty measurement.
  if (Object.keys(metrics).length === 0) return { ok: false, reason: 'unreadable' }

  // "Bel (cm) 76" — the circumference. "Bel / Kalça 0.78" and "Bel / Boy 0.47" are ratios; the band
  // refuses one that slipped through, since no waist is under 30 cm or over 250.
  const w = num(first(new RegExp(String.raw`Bel \(cm\)\s+${N}`, 'u'))?.[1])
  const waistCm = w != null && w >= 30 && w <= 250 ? w : null

  // "2026/11/06 18:46:00" at the top of the sheet.
  const d = first(/(?:^|\s)(\d{4})\/(\d{2})\/(\d{2})\s+\d{2}:\d{2}/mu)
  const takenOn = d ? `${d[1]}-${d[2]}-${d[3]}` : null

  return { ok: true, value: { takenOn, metrics, waistCm } }
}

/** Rebuilds printed lines from text positions: items on the same baseline (±2pt), left to right. */
async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes)
  const out: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent()
    const rows: { y: number; items: { x: number; s: string }[] }[] = []
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      const x = it.transform[4] as number
      const y = it.transform[5] as number
      const row = rows.find((r) => Math.abs(r.y - y) <= 2)
      if (row) row.items.push({ x, s: it.str })
      else rows.push({ y, items: [{ x, s: it.str }] })
    }
    rows.sort((a, b) => b.y - a.y)
    for (const r of rows)
      out.push(
        r.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.s)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
  }
  return out
}

export async function readMeasurementPdf(bytes: Uint8Array): Promise<ParseResult> {
  let lines: string[]
  try {
    lines = await pdfLines(bytes)
  } catch {
    return { ok: false, reason: 'unreadable' } // not a PDF, encrypted, or broken
  }
  try {
    return parseTanitaLines(lines)
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
