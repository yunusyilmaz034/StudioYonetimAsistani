import { instantFromLocalParts, localDateAt, type Instant } from '../../../shared'

// TURNING A SPREADSHEET CELL INTO A DOMAIN VALUE.
//
// Pure, and total in the honest sense: every function here either returns a value or returns null.
// None of them guess. A cell we cannot read becomes a rejected row with a line number the operator
// can go and look at — which is the whole reason the preview step exists.

/**
 * A date cell → the START of that day, in studio-local terms.
 *
 * Accepts what Turkish files actually contain: `19.08.2026`, `19/08/2026`, `19-08-2026`, `2026-08-19`,
 * and the one-digit variants (`1.9.2026`). Day-first is assumed for the dotted and slashed forms
 * because that is what Turkish Excel writes; ISO is recognised by its four-digit lead.
 *
 * Excel's serial numbers do NOT arrive here — the reader resolves date-formatted cells to real dates
 * before this sees them. A bare number is therefore genuinely not a date, and is refused rather than
 * being interpreted as one; the alternative is a package that expires in 1970 and an operator with
 * no way to see why from the file.
 */
export function parseDate(raw: string, utcOffsetMinutes: number): Instant | null {
  const s = raw.trim()
  if (!s) return null

  let y: number, m: number, d: number
  const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s)
  const tr = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s)

  if (iso) {
    y = Number(iso[1])
    m = Number(iso[2])
    d = Number(iso[3])
  } else if (tr) {
    d = Number(tr[1])
    m = Number(tr[2])
    y = Number(tr[3])
  } else return null

  // Midnight studio-local. `instantFromLocalParts` refuses a date the calendar does not have —
  // 31.02.2026 would otherwise parse arithmetically into 3 March, and a package expiring three days
  // late is a bug nobody can see by looking at the file it came from.
  return instantFromLocalParts(y, m, d, utcOffsetMinutes)
}

/**
 * A whole-number cell → a count, or null.
 *
 * Empty is null and that is meaningful: for "kalan ders" it means *this package does not count
 * classes* (a period membership), which is different from zero — zero means she has none left.
 *
 * Tolerates what spreadsheets do to numbers: a trailing `.0` from a float-formatted column, spaces,
 * and a Turkish thousands separator. Refuses anything else rather than reading `8 ders` as 8 — a
 * cell that says more than a number is a cell we have not understood.
 */
export function parseCount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return null

  // A dot is stripped ONLY when it is genuinely a thousands separator — digits in groups of three.
  // Stripping every dot turned "8.5" into 85, which is exactly the sort of silent helpfulness this
  // module exists to refuse. (Caught by its own test, 2026-07-30.)
  const digits = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s

  // A trailing `,0` is a float-formatted column, not a fraction: "8,0" is eight. "8,5" is not a
  // count of anything and is refused.
  const m = /^(\d+)(,0+)?$/.exec(digits)
  if (!m) return null

  const n = Number.parseInt(m[1]!, 10)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * A birth-date cell → `YYYY-MM-DD`, the shape the member record stores.
 *
 * Returns null for an unreadable cell instead of rejecting the row: a birthday is optional, and
 * losing a whole member because her birth date was typed oddly would be the wrong trade. The absence
 * is honest — and a birthday we invent is a card sent on the wrong day, for ever.
 */
export function parseBirthDate(raw: string): string | null {
  const at = parseDate(raw, 0)
  return at === null ? null : localDateAt(at, 0)
}
