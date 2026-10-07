import { describe, expect, it } from 'vitest'

import { addLocalDays } from '../../../shared'
import { templateWeekDays, weekParityAt, type ShiftTemplate } from './shift-template'
import { dayTotals } from './working-time'

// Çapa aralık ortası: +364 gün (52 hafta) ertesi yıla düşüyor, yani yıl dönümü testin içinde.
const ANCHOR = '2026-12-14'

const HAFTA_ICI = (breakMinutes: number) => ({ start: '10:00', end: '21:00', breakMinutes })
const TEMPLATE: ShiftTemplate = {
  cycleAnchorDate: ANCHOR,
  weekA: { 1: HAFTA_ICI(120), 2: HAFTA_ICI(120), 3: HAFTA_ICI(120), 4: HAFTA_ICI(120), 5: HAFTA_ICI(120) },
  weekB: {
    1: HAFTA_ICI(180),
    2: HAFTA_ICI(180),
    3: HAFTA_ICI(180),
    4: HAFTA_ICI(180),
    5: HAFTA_ICI(210),
    6: { start: '11:00', end: '17:00', breakMinutes: 30 },
  },
}

describe('A/B hafta paritesi', () => {
  it('çapa haftası A, sonraki B, sonraki yine A', () => {
    expect(weekParityAt(ANCHOR, ANCHOR)).toBe('A')
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, 7))).toBe('B')
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, 14))).toBe('A')
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, 21))).toBe('B')
  })

  it('haftanın her günü aynı pariteyi verir — gün değil HAFTA sayılıyor', () => {
    for (let i = 0; i < 7; i++) expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, i))).toBe('A')
    for (let i = 7; i < 14; i++) expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, i))).toBe('B')
  })

  it('ÇAPADAN ÖNCEKİ haftalar da doğru — geçmiş çizelge yeniden üretilebilir', () => {
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, -7))).toBe('B')
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, -14))).toBe('A')
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, -21))).toBe('B')
  })

  it('YIL DÖNÜMÜ döngüyü bozmaz: 52 hafta sonra yine A, 53 hafta sonra B', () => {
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, 364))).toBe('A') // 52 hafta, ertesi yıl
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, 371))).toBe('B') // 53 hafta
    expect(weekParityAt(ANCHOR, addLocalDays(ANCHOR, 728))).toBe('A') // iki yıl
  })
})

describe('şablondan hafta üretimi', () => {
  it('WEEK A beş gün verir, Cumartesi YOK', () => {
    const gunler = templateWeekDays(TEMPLATE, ANCHOR)
    expect(Object.keys(gunler)).toHaveLength(5)
    expect(gunler[addLocalDays(ANCHOR, 5)]).toBeUndefined() // Cumartesi
    expect(gunler[addLocalDays(ANCHOR, 6)]).toBeUndefined() // Pazar
  })

  it('WEEK B altı gün verir, Cumartesi DAHİL', () => {
    const gunler = templateWeekDays(TEMPLATE, addLocalDays(ANCHOR, 7))
    expect(Object.keys(gunler)).toHaveLength(6)
    const cmt = gunler[addLocalDays(ANCHOR, 12)]
    expect(cmt).toEqual({ start: '11:00', end: '17:00', breakMinutes: 30 })
    expect(gunler[addLocalDays(ANCHOR, 13)]).toBeUndefined() // Pazar hafta tatili
  })

  it('üretilen iki hafta da tam 45:00 net', () => {
    const topla = (weekStart: string) =>
      Object.values(templateWeekDays(TEMPLATE, weekStart)).reduce((a, d) => a + (dayTotals(d)?.netMinutes ?? 0), 0)
    expect(topla(ANCHOR)).toBe(2700)
    expect(topla(addLocalDays(ANCHOR, 7))).toBe(2700)
  })
})
