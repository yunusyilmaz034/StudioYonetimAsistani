import { describe, expect, it } from 'vitest'

import { MEMBER_FIELDS, PACKAGE_FIELDS } from './fields'
import { cellFor, foldHeader, suggestMapping } from './headers'

describe('foldHeader', () => {
  it('survives the punctuation and accents a real export uses', () => {
    expect(foldHeader('Üye / Müşteri')).toBe('uyemusteri')
    expect(foldHeader('  Ad Soyad ')).toBe('adsoyad')
    expect(foldHeader('Telefon No.')).toBe('telefonno')
  })

  it('folds İ and I identically', () => {
    expect(foldHeader('İSİM')).toBe(foldHeader('isim'))
  })
})

describe('suggestMapping', () => {
  it('pre-fills a Turkish header row', () => {
    const map = suggestMapping(['Ad Soyad', 'Telefon', 'E-posta'], MEMBER_FIELDS)
    expect(map).toMatchObject({ fullName: 0, phone: 1, email: 2 })
  })

  it('leaves a field unmapped rather than guessing', () => {
    const map = suggestMapping(['Ad Soyad', 'Telefon'], MEMBER_FIELDS)
    expect(map.birthDate).toBeNull()
    expect(map.notes).toBeNull()
  })

  it('never gives one column to two fields', () => {
    // "Ad Soyad" is an alias of fullName AND (via 'adi'/'isim') close to nothing else — but a file
    // with both a full-name and a first-name column must not map the same index twice, or one
    // column silently becomes two different meanings.
    const map = suggestMapping(['Ad Soyad', 'Adı'], MEMBER_FIELDS)
    const used = Object.values(map).filter((v): v is number => v !== null)
    expect(new Set(used).size).toBe(used.length)
  })

  it('maps a package file, including the credits column', () => {
    const map = suggestMapping(['Üye', 'Paket Adı', 'Kalan Ders', 'Bitiş Tarihi'], PACKAGE_FIELDS)
    expect(map).toMatchObject({ fullName: 0, productName: 1, remainingCredits: 2, validUntil: 3 })
    expect(map.phone).toBeNull()
  })

  it('finds nothing in a header row it does not recognise, and says so honestly', () => {
    const map = suggestMapping(['kolon1', 'kolon2'], MEMBER_FIELDS)
    expect(Object.values(map).every((v) => v === null)).toBe(true)
  })
})

describe('cellFor', () => {
  const mapping = { fullName: 0, phone: null as number | null }
  it('reads the mapped column', () => {
    expect(cellFor(['AYŞE', '0532'], mapping, {}, 'fullName')).toBe('AYŞE')
  })

  it('falls back to the operator’s manual default when nothing was mapped', () => {
    expect(cellFor(['AYŞE'], mapping, { phone: '05320000000' }, 'phone')).toBe('05320000000')
  })

  it('trims, and folds the non-breaking space spreadsheets leave behind', () => {
    expect(cellFor(['  AYŞE YILMAZ '], mapping, {}, 'fullName')).toBe('AYŞE YILMAZ')
  })

  it('returns empty for a short row rather than throwing', () => {
    // Real files have ragged rows — a trailing row with three cells where the header had seven.
    expect(cellFor([], mapping, {}, 'fullName')).toBe('')
  })
})
