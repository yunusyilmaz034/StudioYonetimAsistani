import type { MemberImportRow } from './import'

// The BulutGym adapter — the ONE piece that is incumbent-specific (Doc 1 §16). Customer #2 arrives
// with a different system, and only this file changes.
//
// ── Why CSV and not .xlsx ───────────────────────────────────────────────────────────────────
// This script runs ONCE, by hand, with admin credentials, against production. It is the most
// dangerous code in the repository, and the correct thing to give it is the SMALLEST possible
// surface: no spreadsheet parser, no dependency, no macro engine. Excel exports CSV in one click,
// and a CSV is human-readable — which is what lets the error report say *"line 34"* to somebody who
// can then open the file and look at line 34.

// PURE: it takes text, not a path. The break-glass script reads the file from disk; the owner's
// import screen reads it in the browser. One parser, two callers — and no second implementation to
// drift away from this one.

/** A CSV reader that handles what Turkish Excel actually produces. */
function parseCsv(text: string): string[][] {
  // Excel writes a UTF-8 BOM. Left in place it becomes part of the first header name, and the
  // column lookup silently fails to find "ad" because the column is really "<BOM>ad".
  const body = text.replace(/^\uFEFF/, '')

  // Turkish Excel defaults to `;` (the comma is the decimal separator here). Sniff, never assume:
  // guessing the delimiter wrong turns every row into one field and the import into nonsense.
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
          field += '"' // an escaped quote inside a quoted field
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

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

// A header, folded to bare ASCII letters: lower-cased in Turkish locale, every Turkish accent mapped
// to its Latin base (ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u), then everything that is not a-z removed. So
// "Üye / Müşteri" → "uyemusteri", "Telefon" → "telefon", "Ad Soyad" → "adsoyad" — the match survives
// spaces, slashes, punctuation and Turkish characters.
function foldHeader(h: string): string {
  return h
    .trim()
    .replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z]/g, '')
}

/** Find a column by any of its plausible headings. Case- and accent-tolerant, never positional. */
function columnIndex(header: readonly string[], candidates: readonly string[]): number {
  const normalised = header.map(foldHeader)
  for (const candidate of candidates) {
    const at = normalised.indexOf(candidate)
    if (at >= 0) return at
  }
  return -1
}

export class MissingColumnError extends Error {}

/**
 * Read the BulutGym export. Accepts EITHER a single full-name column ("Üye / Müşteri", "Ad Soyad", …)
 * OR separate `ad` + `soyad` columns — plus `telefon`. Nothing else is read (packages, credits and
 * balances are opened by hand). (owner, 2026-07-13; single-column names added 2026-07-16.)
 *
 * A missing name/phone column THROWS. It does not fall back to a positional guess: a file whose
 * columns we cannot name is a file we do not understand, and importing a file you do not understand is
 * how a phone number ends up in the name field of forty-five member records.
 */
export function readBulutGymMembers(text: string): readonly MemberImportRow[] {
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) throw new MissingColumnError('Dosya boş')

  // A single column that already holds the whole name — the BulutGym export's "Üye / Müşteri".
  const iFull = columnIndex(header, [
    'uyemusteri', 'uye', 'musteri', 'uyeadi', 'adsoyad', 'adsoyadi', 'adsoyisim', 'isimsoyisim',
    'isimsoyad', 'advesoyad', 'name', 'fullname', 'namesurname',
  ])
  const iName = columnIndex(header, ['ad', 'adi', 'isim', 'firstname'])
  const iSurname = columnIndex(header, ['soyad', 'soyadi', 'surname', 'lastname'])
  const iPhone = columnIndex(header, ['telefon', 'tel', 'gsm', 'cep', 'phone', 'telefonno', 'telefonnumarasi', 'numara'])

  // Prefer a single full-name column; else first+last; else just a first-name column.
  const nameOf: ((cells: readonly string[]) => string) | null =
    iFull >= 0
      ? (cells) => (cells[iFull] ?? '').trim()
      : iName >= 0 && iSurname >= 0
        ? (cells) => `${(cells[iName] ?? '').trim()} ${(cells[iSurname] ?? '').trim()}`.trim()
        : iName >= 0
          ? (cells) => (cells[iName] ?? '').trim()
          : null

  const missing: string[] = []
  if (!nameOf) missing.push('isim (tek "Üye / Müşteri" sütunu ya da "ad" + "soyad")')
  if (iPhone < 0) missing.push('telefon')
  if (missing.length || !nameOf) {
    throw new MissingColumnError(
      `Zorunlu sütun(lar) bulunamadı: ${missing.join(', ')}. Bulunan sütunlar: ${header.join(' | ')}`,
    )
  }

  return rows.slice(1).map((cells, i) => ({
    // +2: the header is line 1, and a human counts from 1. This number is the whole point of the
    // error report — it is what she types into the "go to line" box.
    line: i + 2,
    fullName: nameOf(cells),
    phoneRaw: (cells[iPhone] ?? '').trim(),
  }))
}
