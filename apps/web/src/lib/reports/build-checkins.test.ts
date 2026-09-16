import { describe, expect, it } from 'vitest'

import type { CheckIn, Member } from '@studio/core'

import { buildCheckins, checkinPeriodOf } from './build'

// Check-in raporu (owner, 2026-09-15). Sınırlar stüdyo saatiyle: gün 00:00 TRT'de, hafta Pazartesi başlar.
const at = (iso: string) => Date.parse(iso)
const ci = (memberId: string, iso: string, direction: 'in' | 'out' = 'in', method = 'device') =>
  ({ id: `chk_${iso}`, memberId, direction, method, occurredAt: at(iso), branchId: 'b', studioId: 's', actor: {} }) as unknown as CheckIn
const members = [
  { id: 'm1', fullName: 'AYŞE YILMAZ' },
  { id: 'm2', fullName: 'BUSE KAYA' },
] as unknown as Member[]

describe('checkinPeriodOf', () => {
  it('gün İstanbul gece yarısında değişir (UTC 21:00)', () => {
    expect(checkinPeriodOf(at('2026-09-14T20:59:59Z'), 'day').label).toBe('14.09.2026')
    expect(checkinPeriodOf(at('2026-09-14T21:00:00Z'), 'day').label).toBe('15.09.2026')
  })
  it('hafta Pazartesi başlar: Pazar 23:30 önceki hafta, Pazartesi 00:10 yeni hafta', () => {
    expect(checkinPeriodOf(at('2026-09-13T20:30:00Z'), 'week').label).toBe('07.09–13.09.2026')
    expect(checkinPeriodOf(at('2026-09-13T21:10:00Z'), 'week').label).toBe('14.09–20.09.2026')
  })
  it('ay İstanbul tarihine göre: 30 Eylül 22:00Z = 1 Ekim', () => {
    expect(checkinPeriodOf(at('2026-09-30T20:59:00Z'), 'month').label).toBe('Eylül 2026')
    expect(checkinPeriodOf(at('2026-09-30T22:00:00Z'), 'month').label).toBe('Ekim 2026')
  })
})

describe('buildCheckins', () => {
  const kayitlar = [
    ci('m1', '2026-09-14T06:00:00Z'),
    ci('m1', '2026-09-14T07:00:00Z', 'out'),
    ci('m1', '2026-09-14T15:00:00Z', 'in', 'qr'),
    ci('m2', '2026-09-15T08:00:00Z', 'in', 'reception'),
    ci('m1', '2026-09-15T09:00:00Z'),
  ]
  it('günlük: dönem × üye, yalnızca girişler sayılır, en çok gelen önce', () => {
    const r = buildCheckins(kayitlar, members, 'day')
    expect(r.table.columns).toEqual(['Dönem', 'Üye', 'Giriş sayısı', 'Giriş', 'Çıkış', 'Giriş yolu'])
    expect(r.table.rows.map((x) => [x[0], x[1], x[2], x[5]])).toEqual([
      ['14.09.2026', 'AYŞE YILMAZ', 2, 'Turnike · QR'],
      ['15.09.2026', 'AYŞE YILMAZ', 1, 'Turnike'],
      ['15.09.2026', 'BUSE KAYA', 1, 'Resepsiyon'],
    ])
    expect(r.summary).toBe('4 giriş · 2 farklı üye · 2 gün · gün başına ortalama 2 giriş')
  })

  // GİRİŞ VE ÇIKIŞ (owner, 2026-09-16): "ne zaman geldi, ne zaman gitti". Çıkışı olmayan üyede hücre boş kalır —
  // uydurulmuş bir saat, olmayan bir kayıttan kötüdür.
  it('giriş sütunu ilk girişi, çıkış sütunu son çıkışı gösterir; çıkış yoksa — kalır', () => {
    const r = buildCheckins(kayitlar, members, 'day')
    const ayse14 = r.table.rows[0]!
    expect(String(ayse14[3])).toContain('09:00') // 06:00Z = 09:00 TRT, ilk giriş
    expect(String(ayse14[4])).toContain('10:00') // 07:00Z = 10:00 TRT, çıkış
    const buse = r.table.rows.find((x) => x[1] === 'BUSE KAYA')!
    expect(buse[4]).toBe('—') // çıkış okutmamış
  })
  it('haftalık: aynı haftadaki girişler tek satırda toplanır', () => {
    const r = buildCheckins(kayitlar, members, 'week')
    expect(r.table.rows.map((x) => [x[0], x[1], x[2]])).toEqual([
      ['14.09–20.09.2026', 'AYŞE YILMAZ', 3],
      ['14.09–20.09.2026', 'BUSE KAYA', 1],
    ])
  })
  it('boş aralık açıkça söylenir; silinmiş üye adsız kalmaz', () => {
    expect(buildCheckins([], members, 'month').summary).toBe('Bu aralıkta check-in yok.')
    expect(buildCheckins([ci('mX', '2026-09-15T08:00:00Z')], members, 'month').table.rows[0]?.[1]).toBe('Silinmiş üye')
  })
})
