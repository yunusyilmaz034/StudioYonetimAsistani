import { describe, expect, it } from 'vitest'

import type { Instant, MemberId, ProductId } from '../../../shared'
import { buildMembers, buildPackages, missingRequired, needsDecision, type NormalizePhone } from './build'
import type { MatchCandidate } from './match'

const TR = 180
const TODAY = 1_785_000_000_000 as Instant

// A stand-in for the real normaliser: enough to exercise the boundary without importing the members
// module (each module has one door, and `build` must not reach through it).
const normalize: NormalizePhone = (raw) => {
  const digits = raw.replace(/\D/g, '')
  const nsn = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits.length === 12 && digits.startsWith('90') ? digits.slice(2) : digits
  return /^5\d{9}$/.test(nsn) ? { e164: `+90${nsn}`, normalized: `90${nsn}` } : null
}

const AYSE: MatchCandidate = { memberId: 'mem_ayse' as MemberId, fullName: 'AYŞE YILMAZ', phoneNormalized: '905321111111' }
const PRODUCTS = [
  { productId: 'prd_r8' as ProductId, name: 'Reformer Pilates - 8 Ders' },
  { productId: 'prd_f1' as ProductId, name: 'Fitness - 1 Aylık' },
]

const HEADER = ['Ad Soyad', 'Telefon', 'Paket', 'Kalan Ders', 'Bitiş Tarihi']
const MAP = { fullName: 0, phone: 1, productName: 2, remainingCredits: 3, validUntil: 4, validFrom: null, note: null }

describe('buildMembers', () => {
  const map = { fullName: 0, phone: 1, email: null, birthDate: null, notes: null }

  it('accepts a clean row', () => {
    const out = buildMembers([['Ad', 'Tel'], ['AYŞE YILMAZ', '0532 111 11 11']], map, {}, [], normalize, 0)
    expect(out.rejected).toEqual([])
    expect(out.ready[0]).toMatchObject({ line: 2, phoneE164: '+905321111111', duplicateOf: null })
  })

  it('rejects an unreadable phone with the value in the message', () => {
    // The operator has to be able to open the file at that line and see the problem. "Geçersiz satır"
    // sends her hunting; the offending value does not.
    const out = buildMembers([['Ad', 'Tel'], ['AYŞE', '5,32E+10']], map, {}, [], normalize, 0)
    expect(out.ready).toEqual([])
    expect(out.rejected[0]).toMatchObject({ line: 2, reason: 'Telefon okunamadı: 5,32E+10' })
  })

  it('rejects a nameless row', () => {
    const out = buildMembers([['Ad', 'Tel'], ['', '05321111111']], map, {}, [], normalize, 0)
    expect(out.rejected[0]!.reason).toBe('Ad Soyad boş')
  })

  it('rejects the SECOND occurrence of a phone in the same file, pointing at the first', () => {
    // A roster that lists the same woman twice is ordinary. Importing her twice is not.
    const out = buildMembers(
      [['Ad', 'Tel'], ['AYŞE', '05321111111'], ['AYSE Y.', '0532 111 11 11']],
      map, {}, [], normalize, 0,
    )
    expect(out.ready).toHaveLength(1)
    expect(out.rejected[0]!.reason).toBe('Bu telefon dosyada 2. satırda da var')
  })

  it('flags a phone that already belongs to a member — reported, never merged (AD-40)', () => {
    const out = buildMembers([['Ad', 'Tel'], ['AYŞE YILMAZ', '05321111111']], map, {}, [AYSE], normalize, 0)
    expect(out.ready[0]!.duplicateOf).toBe('mem_ayse')
  })

  it('honours a header row that is not the first — real files have titles above it', () => {
    const rows = [['Pilates Fitness by Işıl'], [], ['Ad Soyad', 'Telefon'], ['AYŞE', '05321111111']]
    const out = buildMembers(rows, map, {}, [], normalize, 2)
    expect(out.ready).toHaveLength(1)
    expect(out.ready[0]!.line).toBe(4)
  })
})

describe('buildPackages', () => {
  const build = (rows: readonly (readonly string[])[], existing: readonly MatchCandidate[] = []) =>
    buildPackages(rows, MAP, {}, existing, PRODUCTS, normalize, TR, TODAY, 0)

  it('matches the catalogue across punctuation and case', () => {
    const out = build([HEADER, ['AYŞE YILMAZ', '05321111111', 'reformer pilates 8 ders', '5', '19.08.2026']], [AYSE])
    expect(out.rejected).toEqual([])
    expect(out.ready[0]).toMatchObject({ productId: 'prd_r8', remainingCredits: 5 })
    expect(out.ready[0]!.match).toEqual({ kind: 'phone', memberId: 'mem_ayse' })
  })

  it('REJECTS an unknown package name and reports it — never picks a near one', () => {
    // A wrong package id is a right in the wrong CATEGORY: a pilates credit that opens the gym.
    // The category wall is the one thing the UI cannot repair afterwards.
    const out = build([HEADER, ['AYŞE', '05321111111', 'Reformer 10 Ders', '5', '19.08.2026']])
    expect(out.ready).toEqual([])
    expect(out.unknownProducts).toEqual(['Reformer 10 Ders'])
    expect(out.rejected[0]!.reason).toContain('Katalogda böyle bir paket yok')
  })

  it('keeps an empty credits cell as null — a period package counts no classes', () => {
    const out = build([HEADER, ['AYŞE', '05321111111', 'Fitness - 1 Aylık', '', '19.08.2026']])
    expect(out.ready[0]!.remainingCredits).toBeNull()
  })

  it('keeps a zero — none left is not the same as does not count', () => {
    const out = build([HEADER, ['AYŞE', '05321111111', 'Reformer Pilates - 8 Ders', '0', '19.08.2026']])
    expect(out.ready[0]!.remainingCredits).toBe(0)
  })

  it('rejects an unreadable credits cell rather than importing an unlimited package', () => {
    const out = build([HEADER, ['AYŞE', '05321111111', 'Reformer Pilates - 8 Ders', '8 ders', '19.08.2026']])
    expect(out.rejected[0]!.reason).toBe('Kalan ders okunamadı: 8 ders')
  })

  it('defaults a missing start date to today, and refuses a start after the end', () => {
    const ok = build([HEADER, ['AYŞE', '05321111111', 'Fitness - 1 Aylık', '', '19.08.2026']])
    expect(ok.ready[0]!.validFrom).toBe(TODAY)

    const map = { ...MAP, validFrom: 5 }
    const bad = buildPackages(
      [[...HEADER, 'Başlangıç'], ['AYŞE', '05321111111', 'Fitness - 1 Aylık', '', '19.08.2026', '20.09.2026']],
      map, {}, [], PRODUCTS, normalize, TR, TODAY, 0,
    )
    expect(bad.rejected[0]!.reason).toBe('Başlangıç tarihi bitişten sonra')
  })

  it('flags a row that would need a new member but has no phone to create her with', () => {
    // Reported in the PREVIEW. A screen that says "Yeni üye + paket" and then fails at apply time
    // has told the operator something untrue at the only moment she was looking.
    const noPhone = { ...MAP, phone: null }
    const out = buildPackages(
      [HEADER, ['ZEYNEP DEMİR', '', 'Reformer Pilates - 8 Ders', '5', '19.08.2026']],
      noPhone, {}, [], PRODUCTS, normalize, TR, TODAY, 0,
    )
    expect(out.ready[0]!.needsPhoneToCreate).toBe(true)
  })

  it('does not flag a row whose member was found by phone', () => {
    const out = build([HEADER, ['AYŞE YILMAZ', '05321111111', 'Reformer Pilates - 8 Ders', '5', '19.08.2026']], [AYSE])
    expect(out.ready[0]!.needsPhoneToCreate).toBe(false)
  })

  it('proposes when there is no phone, and never resolves it itself', () => {
    const noPhone = { ...MAP, phone: null }
    const out = buildPackages(
      [HEADER, ['AYŞE YILMAZ', '', 'Reformer Pilates - 8 Ders', '5', '19.08.2026']],
      noPhone, {}, [AYSE], PRODUCTS, normalize, TR, TODAY, 0,
    )
    expect(out.ready[0]!.match.kind).toBe('proposal')
    expect(needsDecision(out.ready)).toHaveLength(1)
  })

  it('leaves a phone-matched row out of the decisions queue', () => {
    const out = build([HEADER, ['AYŞE YILMAZ', '05321111111', 'Reformer Pilates - 8 Ders', '5', '19.08.2026']], [AYSE])
    expect(needsDecision(out.ready)).toEqual([])
  })

  it('lets the SAME member appear twice — one row per package is the documented shape', () => {
    const out = build(
      [
        HEADER,
        ['AYŞE YILMAZ', '05321111111', 'Reformer Pilates - 8 Ders', '5', '19.08.2026'],
        ['AYŞE YILMAZ', '05321111111', 'Fitness - 1 Aylık', '', '19.09.2026'],
      ],
      [AYSE],
    )
    expect(out.rejected).toEqual([])
    expect(out.ready).toHaveLength(2)
  })
})

describe('missingRequired', () => {
  it('names the required fields the file did not supply', () => {
    expect(missingRequired('members', { fullName: 0, phone: null })).toEqual(['phone'])
    expect(missingRequired('member_packages', { fullName: 0, productName: null, validUntil: null })).toEqual([
      'productName',
      'validUntil',
    ])
  })

  it('is empty when everything required is mapped', () => {
    expect(missingRequired('members', { fullName: 0, phone: 1 })).toEqual([])
  })

  it('counts a typed default as supplied — otherwise the gap step never clears', () => {
    // The gap-filling step exists so she can type a value that applies to every row. A check that
    // ignored what she typed would send her back to the same step for ever.
    expect(missingRequired('members', { fullName: 0, phone: null }, { phone: '05320000000' })).toEqual([])
    expect(missingRequired('members', { fullName: 0, phone: null }, { phone: '   ' })).toEqual(['phone'])
  })
})
