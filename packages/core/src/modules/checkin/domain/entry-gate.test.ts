import { describe, expect, it } from 'vitest'

import { entryRefusalReason, type EntryRight } from './entry-gate'

// KAPI: ELİNDE HAK KALDI MI? (owner, 2026-09-14 · OR-78) ve HANGİ HAK? (owner, 2026-10-08 · OR-121).
// Sınırlar: son ders, tutulan ders, son giriş hakkı — ve ders paketinin tek başına kapıyı açmaması.

/** Ders paketi (pilates, PT): kapıyı paket değil dersin saati açar. */
const ders = (remaining: number, held = 0): EntryRight => ({ classOnly: true, credits: { remaining, held }, entries: null })
const dersSinirsiz: EntryRight = { classOnly: true, credits: null, entries: null }
/** Fitness paketleri: duran hak. */
const giris = (remaining: number): EntryRight => ({ classOnly: false, credits: null, entries: { remaining } })
const fitnessKredi = (remaining: number): EntryRight => ({ classOnly: false, credits: { remaining, held: 0 }, entries: null })
const sinirsiz: EntryRight = { classOnly: false, credits: null, entries: null }

describe('entryRefusalReason', () => {
  it('geçerli paketi yoksa: paket yok', () => {
    expect(entryRefusalReason([])).toBe('no_active_membership')
  })

  it('sınırsız fitness her zaman girer', () => {
    expect(entryRefusalReason([sinirsiz])).toBeNull()
  })

  it('sınır: bir giriş hakkı kalan girer, sıfır kalan girmez', () => {
    expect(entryRefusalReason([giris(1)])).toBeNull()
    expect(entryRefusalReason([giris(0)])).toBe('no_entries_left')
  })

  it('fitness kategorisindeki kredili paket duran haktır: bir kalan girer, sıfır kalan girmez', () => {
    expect(entryRefusalReason([fitnessKredi(1)])).toBeNull()
    expect(entryRefusalReason([fitnessKredi(0)])).toBe('no_credits_left')
  })

  it('hepsi bitmişse: yalnızca giriş haklı paket varsa "giriş hakkı bitti", karışıksa "dersler bitti"', () => {
    expect(entryRefusalReason([giris(0), giris(0)])).toBe('no_entries_left')
    expect(entryRefusalReason([giris(0), ders(0)])).toBe('no_credits_left')
  })
})

describe('ders paketi kapıyı tek başına açmaz (OR-121)', () => {
  it('dersi kalan pilates üyesi: paket sağlam, saat değil — "bu saatte dersi yok"', () => {
    expect(entryRefusalReason([ders(3)])).toBe('no_class_now')
  })

  it('sınır: tek dersi kalan da, yalnızca TUTULAN dersi olan da aynı cevabı alır', () => {
    // Tutulan ders gelecek haftanın rezervasyonu olabilir; bugünün kapısını o açmaz, dersin saati açar.
    expect(entryRefusalReason([ders(1)])).toBe('no_class_now')
    expect(entryRefusalReason([ders(0, 1)])).toBe('no_class_now')
  })

  it('dersleri bitmişse sebep hâlâ "dersler bitti" — o bir yenileme konusu, bu değil', () => {
    expect(entryRefusalReason([ders(0)])).toBe('no_credits_left')
  })

  it('süreli (kredisiz) ders paketi de salonu açmaz', () => {
    expect(entryRefusalReason([dersSinirsiz])).toBe('no_class_now')
  })

  it('hibrit: fitness hakkı duruyorsa girer; ders paketi buna engel değil', () => {
    expect(entryRefusalReason([giris(2), ders(3)])).toBeNull()
    expect(entryRefusalReason([sinirsiz, ders(0)])).toBeNull()
  })

  it('hibrit: fitness hakkı BİTMİŞ, dersi kalmış — artık yalnızca dersinin saatinde girer', () => {
    expect(entryRefusalReason([giris(0), ders(2)])).toBe('no_class_now')
  })
})
