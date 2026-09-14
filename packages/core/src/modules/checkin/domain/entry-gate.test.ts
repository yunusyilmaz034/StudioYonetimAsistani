import { describe, expect, it } from 'vitest'

import { entryRefusalReason, type EntryRight } from './entry-gate'

// KAPI: ELİNDE HAK KALDI MI? (owner, 2026-09-14 · OR-78). Sınırlar: son ders, tutulan ders, son giriş hakkı.

const kredi = (remaining: number, held = 0): EntryRight => ({ credits: { remaining, held }, entries: null })
const giris = (remaining: number): EntryRight => ({ credits: null, entries: { remaining } })
const sinirsiz: EntryRight = { credits: null, entries: null }

describe('entryRefusalReason', () => {
  it('geçerli paketi yoksa: paket yok', () => {
    expect(entryRefusalReason([])).toBe('no_active_membership')
  })

  it('sınırsız paket her zaman girer', () => {
    expect(entryRefusalReason([sinirsiz])).toBeNull()
  })

  it('sınır: bir dersi kalan girer, sıfır kalan girmez', () => {
    expect(entryRefusalReason([kredi(1)])).toBeNull()
    expect(entryRefusalReason([kredi(0)])).toBe('no_credits_left')
  })

  it('kalan dersi sıfır ama bugüne TUTULAN dersi olan girer — o ders onun', () => {
    expect(entryRefusalReason([kredi(0, 1)])).toBeNull()
  })

  it('sınır: bir giriş hakkı kalan girer, sıfır kalan girmez', () => {
    expect(entryRefusalReason([giris(1)])).toBeNull()
    expect(entryRefusalReason([giris(0)])).toBe('no_entries_left')
  })

  it('hibrit: fitness hakkı bitmiş ama dersi kalan girer', () => {
    expect(entryRefusalReason([giris(0), kredi(2)])).toBeNull()
  })

  it('hepsi bitmişse: yalnızca giriş haklı paket varsa "giriş hakkı bitti", karışıksa "dersler bitti"', () => {
    expect(entryRefusalReason([giris(0), giris(0)])).toBe('no_entries_left')
    expect(entryRefusalReason([giris(0), kredi(0)])).toBe('no_credits_left')
  })
})
