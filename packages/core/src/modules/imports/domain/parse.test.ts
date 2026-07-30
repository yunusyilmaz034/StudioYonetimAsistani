import { describe, expect, it } from 'vitest'

import { parseBirthDate, parseCount, parseDate } from './parse'

const TR = 180 // studio offset, minutes
// 2026-08-19T00:00:00Z. Written as a literal because `Date` is banned in `domain/` — a test that
// computes its own expectation with the same arithmetic the code uses proves only that the
// arithmetic is self-consistent.
const AUG_19_UTC = 1_787_097_600_000

describe('parseDate', () => {
  const expected = AUG_19_UTC - TR * 60_000

  it('reads what Turkish Excel writes', () => {
    for (const s of ['19.08.2026', '19/08/2026', '19-08-2026', '19.8.2026']) {
      expect(parseDate(s, TR), s).toBe(expected)
    }
  })

  it('reads ISO, recognised by its four-digit lead', () => {
    expect(parseDate('2026-08-19', TR)).toBe(expected)
  })

  it('lands on midnight STUDIO time, not server time', () => {
    // Built from UTC and shifted by the studio's offset. `new Date(y, m, d)` would read whatever
    // timezone the server happens to run in, and the server is not where the studio is.
    expect(parseDate('19.08.2026', 0)).toBe(AUG_19_UTC)
    expect(parseDate('19.08.2026', TR)).toBe(AUG_19_UTC - 3 * 3_600_000)
  })

  it('refuses a date the calendar refuses', () => {
    // 31.02 parses arithmetically into 3 March. A package quietly expiring three days late is worse
    // than a row the operator is asked to look at.
    expect(parseDate('31.02.2026', TR)).toBeNull()
    expect(parseDate('30.02.2026', TR)).toBeNull()
    expect(parseDate('00.08.2026', TR)).toBeNull()
    expect(parseDate('19.13.2026', TR)).toBeNull()
  })

  it('accepts a real leap day and rejects a fake one', () => {
    expect(parseDate('29.02.2028', TR)).not.toBeNull()
    expect(parseDate('29.02.2026', TR)).toBeNull()
  })

  it('refuses a bare number — an Excel serial must never be read as a date here', () => {
    // The reader resolves date-formatted cells before this sees them, so a number arriving here is
    // genuinely not a date. Interpreting it would produce an expiry in 1970 that the operator cannot
    // explain by looking at the file, because the cell plainly says a date.
    expect(parseDate('46253', TR)).toBeNull()
  })

  it('refuses empty and nonsense rather than guessing', () => {
    for (const s of ['', '   ', 'yakında', '19.08', '2026', '19.08.26']) {
      expect(parseDate(s, TR), s).toBeNull()
    }
  })
})

describe('parseCount', () => {
  it('reads a plain number', () => {
    expect(parseCount('5')).toBe(5)
    expect(parseCount(' 12 ')).toBe(12)
  })

  it('distinguishes empty from zero — they mean different things', () => {
    // Empty: this package does not count classes (a period membership).
    // Zero: she has none left. Collapsing them would hand out unlimited access or none at all.
    expect(parseCount('')).toBeNull()
    expect(parseCount('   ')).toBeNull()
    expect(parseCount('0')).toBe(0)
  })

  it('tolerates a float-formatted column and a thousands separator', () => {
    expect(parseCount('8,0')).toBe(8)
    expect(parseCount('1.200')).toBe(1200)
  })

  it('refuses a cell that says more than a number', () => {
    // "8 ders" is a cell we have not understood. Reading the 8 out of it is the kind of helpfulness
    // that puts a phone number in a name field.
    for (const s of ['8 ders', 'sınırsız', '-3', '8.5', '8,5', 'sekiz', '1.20', '.5']) {
      expect(parseCount(s), s).toBeNull()
    }
    // "8.5" is the one that bit: stripping every dot as a thousands separator turned it into 85.
    // The separator is only honoured in its real shape — digits in groups of three.
    expect(parseCount('8.5')).toBeNull()
    expect(parseCount('1.200')).toBe(1200)
    expect(parseCount('1.200.000')).toBe(1_200_000)
  })
})

describe('parseBirthDate', () => {
  it('returns the stored shape', () => {
    expect(parseBirthDate('01.01.1991')).toBe('1991-01-01')
    expect(parseBirthDate('1991-01-01')).toBe('1991-01-01')
  })

  it('returns null instead of rejecting the member', () => {
    // A birthday is optional. Losing a whole member because her birth date was typed oddly is the
    // wrong trade — and an invented birthday is a card sent on the wrong day for ever.
    expect(parseBirthDate('bilinmiyor')).toBeNull()
    expect(parseBirthDate('')).toBeNull()
  })
})
