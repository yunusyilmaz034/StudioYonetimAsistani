import { describe, expect, it } from 'vitest'

import { isClean, validateMembers, type MemberImportRow } from './import'

// The rules that decide what enters production, tested in milliseconds.
//
// Everything else in this milestone can be rewritten. An import cannot: forty-five women's records
// are written once, and the mistakes are the kind you discover in March.

const row = (line: number, fullName: string, phoneRaw: string): MemberImportRow => ({
  line,
  fullName,
  phoneRaw,
})

describe('phones are normalised to E.164, or the row is refused (AD-40)', () => {
  it('accepts the formats the source actually contains', () => {
    const report = validateMembers([
      row(2, 'Elif Yılmaz', '05321234567'),
      row(3, 'Merve Kaya', '5331234567'),
      row(4, 'Ayşe Demir', '+90 534 123 45 67'),
      row(5, 'Selin Ak', '0535 123 45 67'),
    ])

    expect(isClean(report)).toBe(true)
    expect(report.valid.map((v) => v.phoneE164)).toEqual([
      '+905321234567',
      '+905331234567',
      '+905341234567',
      '+905351234567',
    ])
  })

  it('REFUSES a number it cannot normalise — it never guesses one into shape', () => {
    const report = validateMembers([row(2, 'Zeynep Ak', '532 12')])

    expect(isClean(report)).toBe(false)
    expect(report.rejected[0]).toMatchObject({ line: 2, reason: 'phone_not_normalisable' })
    expect(report.valid).toEqual([])
  })
})

describe('a collision is REPORTED, never merged (I-21)', () => {
  it('refuses the second row and names the line it collides with', () => {
    // Two rows, one phone. This might be a mother and daughter, a typo, or the same woman entered
    // twice — and only a phone call settles it. Merging them is how one member ends up holding
    // another member's package.
    const report = validateMembers([
      row(2, 'Elif Yılmaz', '0532 123 45 67'),
      row(9, 'Elif Y.', '+905321234567'), // the SAME number, differently written
    ])

    expect(isClean(report)).toBe(false)
    expect(report.rejected).toHaveLength(1)
    expect(report.rejected[0]).toMatchObject({
      line: 9,
      reason: 'duplicate_phone',
      collidesWithLine: 2, // the human needs BOTH lines to decide
    })
  })
})

describe('an incomplete row is a gap, not a member', () => {
  it('refuses a row with no phone', () => {
    // She could not be invited to the portal, could not be found by reception's search, and could
    // not be told her class was cancelled. That is not a record; it is a hole with a name on it.
    const report = validateMembers([row(2, 'İsimsiz Numara', '')])
    expect(report.rejected[0]?.reason).toBe('missing_phone')
  })

  it('refuses a row with no name', () => {
    const report = validateMembers([row(2, '   ', '05321234567')])
    expect(report.rejected[0]?.reason).toBe('missing_name')
  })
})

describe('the run is all-or-nothing', () => {
  it('reports the WHOLE picture rather than importing the good half', () => {
    const report = validateMembers([
      row(2, 'Elif Yılmaz', '05321234567'),
      row(3, 'Bozuk Satır', 'abc'),
      row(4, 'Merve Kaya', '05331234567'),
    ])

    // The two good rows are still *reported* as valid — the owner must see what would have gone in.
    expect(report.valid).toHaveLength(2)
    // But the file is not clean, and `run.ts` refuses on exactly this. A partial import leaves a
    // members list that is *almost* right, and nobody can tell which half.
    expect(isClean(report)).toBe(false)
    expect(report.total).toBe(3)
  })
})
