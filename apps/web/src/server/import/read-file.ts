import 'server-only'

import ExcelJS from 'exceljs'

// READING THE OPERATOR'S FILE.
//
// Everything downstream of this file — mapping, matching, preview, apply — sees `string[][]` and has
// no idea whether it came from a spreadsheet or a text file. That is the point: a new format one day
// (a Google Sheets link, a vendor's JSON) is a new reader here and nothing else. The format is a
// boundary detail, normalised at the edge.
//
// ── Why exceljs and not `xlsx` ──────────────────────────────────────────────────────────────
//
// SheetJS's npm package stops at 0.18.5 and carries known advisories whose fixes were published
// only outside npm. This parses files an operator uploads into a live business system; taking a
// library we already know we cannot patch is not a trade worth making for a smaller bundle.
//
// ── Why dates are the hard part, not security ───────────────────────────────────────────────
//
// Excel stores 19.08.2026 as the number 46253. A reader that hands back the number turns every
// package expiry into 1970, or into a rejected row nobody can explain by looking at the file — the
// cell plainly says a date. exceljs resolves date-formatted cells to real `Date` objects, and this
// file converts them to `dd.MM.yyyy` so the downstream parser sees the same shape a CSV would give.
//
// ── Limits ──────────────────────────────────────────────────────────────────────────────────
//
// An .xlsx is a zip archive. Nobody has to be malicious for a 2 MB file to expand into something
// that takes the panel down — a stray sheet with two hundred thousand formatted-but-empty rows does
// it. So: a size cap, a row cap, and the first worksheet only.

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ROWS = 5_000

export class FileTooLargeError extends Error {}
export class FileUnreadableError extends Error {}

/** A file the operator uploaded, normalised to rows of trimmed strings. */
export interface SheetData {
  readonly rows: readonly (readonly string[])[]
  /** Sheet names found. The first is the one read; the rest are reported so a wrong pick is visible. */
  readonly sheetNames: readonly string[]
  readonly truncated: boolean
}

function assertSize(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new FileTooLargeError(`Dosya çok büyük (en fazla ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB).`)
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────
//
// Turkish Excel writes `;` (the comma is the decimal separator here) and leaves a UTF-8 BOM. Both
// are sniffed rather than assumed: guessing the delimiter wrong turns every row into a single field
// and the import into nonsense, and a BOM left in place becomes part of the first header name, so
// the column lookup silently fails to find "ad" because the column is really "<BOM>ad".

export function readCsv(text: string): SheetData {
  assertSize(Buffer.byteLength(text, 'utf8'))
  const body = text.replace(/^\ufeff/, '')
  const firstLine = body.split(/\r?\n/)[0] ?? ''
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','

  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      field = ''
      row = []
    } else if (ch !== '\r') field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  const kept = rows.filter((r) => r.some((cell) => cell.trim() !== ''))
  return {
    rows: kept.slice(0, MAX_ROWS).map((r) => r.map((c) => c.trim())),
    sheetNames: [],
    truncated: kept.length > MAX_ROWS,
  }
}

// ── XLSX ────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * One cell as the string a human would see.
 *
 * A `Date` becomes `dd.MM.yyyy` — the format Turkish Excel displays and the one the date parser
 * downstream already understands. A formula cell yields its CACHED RESULT: we read what the file
 * says, we never evaluate, because evaluating an uploaded formula is running an uploaded program.
 */
function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return `${pad(value.getUTCDate())}.${pad(value.getUTCMonth() + 1)}.${value.getUTCFullYear()}`
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if ('text' in v) return String(v.text ?? '').trim() // hyperlink / rich text
    if ('result' in v) return String(v.result ?? '').trim() // formula → cached result only
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((p) => String((p as { text?: unknown }).text ?? '')).join('').trim()
    }
    if ('error' in v) return '' // #REF! and friends are not data
    return ''
  }
  return String(value).trim()
}

export async function readXlsx(buffer: Buffer): Promise<SheetData> {
  assertSize(buffer.byteLength)
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    throw new FileUnreadableError('Excel dosyası okunamadı. Dosyanın bozuk olmadığından emin olun.')
  }

  const sheetNames = wb.worksheets.map((w) => w.name)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new FileUnreadableError('Dosyada sayfa bulunamadı.')

  const rows: string[][] = []
  let truncated = false
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length >= MAX_ROWS) {
      truncated = true
      return
    }
    // `row.values` is 1-indexed with a hole at 0 — a real trap, because slicing it wrong shifts
    // every column by one and the mapping screen then looks correct while reading the wrong cells.
    const values = (row.values as unknown[]).slice(1)
    const cells = values.map(cellText)
    if (cells.some((c) => c !== '')) rows.push(cells)
  })

  return { rows, sheetNames, truncated }
}

/** Read whatever was uploaded. The extension decides; the content is what is trusted. */
export async function readUpload(fileName: string, bytes: Buffer): Promise<SheetData> {
  const isXlsx = /\.xlsx$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b) // 'PK' — a zip
  return isXlsx ? readXlsx(bytes) : readCsv(bytes.toString('utf8'))
}
