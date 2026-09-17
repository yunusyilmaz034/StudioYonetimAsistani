import { describe, expect, it } from 'vitest'

import type { CheckIn, Member } from '@studio/core'

import { buildCheckins } from './build'

// Check-in raporu (owner, 2026-09-15; 17 Eylül'de tek rapora indi). Gün sınırı stüdyo saatiyle: 00:00 TRT.
const at = (iso: string) => Date.parse(iso)
const ci = (memberId: string, iso: string, direction: 'in' | 'out' = 'in', method = 'device') =>
  ({ id: `chk_${iso}`, memberId, direction, method, occurredAt: at(iso), branchId: 'b', studioId: 's', actor: {} }) as unknown as CheckIn
const members = [
  { id: 'm1', fullName: 'AYŞE YILMAZ' },
  { id: 'm2', fullName: 'BUSE KAYA' },
] as unknown as Member[]

describe('buildCheckins', () => {
  const kayitlar = [
    ci('m1', '2026-09-14T06:00:00Z'),
    ci('m1', '2026-09-14T07:00:00Z', 'out'),
    ci('m1', '2026-09-14T15:00:00Z', 'in', 'qr'),
    ci('m2', '2026-09-15T08:00:00Z', 'in', 'reception'),
    ci('m1', '2026-09-15T09:00:00Z'),
  ]

  it('satır = ÜYE (dönem kırılımı yok): aralığın tamamı tek satırda toplanır', () => {
    const r = buildCheckins(kayitlar, members)
    expect(r.table.columns).toEqual(['Üye', 'Giriş sayısı', 'İlk giriş', 'Son çıkış', 'Giriş yolu'])
    expect(r.table.rows).toHaveLength(2)
    // m1: 14.09'da iki, 15.09'da bir giriş = 3. En çok gelen önce.
    expect(r.table.rows[0]?.[0]).toBe('AYŞE YILMAZ')
    expect(r.table.rows[0]?.[1]).toBe(3)
    expect(r.table.rows[1]?.[0]).toBe('BUSE KAYA')
    expect(r.table.rows[1]?.[1]).toBe(1)
  })

  it('çıkış bir ziyaret değildir: sayılmaz, ama Son çıkış sütununu doldurur', () => {
    const r = buildCheckins(kayitlar, members)
    expect(r.summary.startsWith('4 giriş · 2 farklı üye')).toBe(true)
    expect(r.table.rows[0]?.[3]).not.toBe('—') // m1'in çıkışı var
    expect(r.table.rows[1]?.[3]).toBe('—') // m2 çıkış okutmamış
  })

  it('GÜN GÜN toplam özette yazar (owner: "dün 15, bugün 10")', () => {
    const r = buildCheckins(kayitlar, members)
    expect(r.summary).toContain('2 gün')
    expect(r.summary).toContain('14.09: 2')
    expect(r.summary).toContain('15.09: 2')
  })

  it('gün sınırı İstanbul gece yarısıdır: 20:59Z önceki gün, 21:00Z yeni gün', () => {
    const r = buildCheckins([ci('m1', '2026-09-14T20:59:59Z'), ci('m2', '2026-09-14T21:00:00Z')], members)
    expect(r.summary).toContain('14.09: 1')
    expect(r.summary).toContain('15.09: 1')
  })

  it('uzun aralıkta gün listesi kısalır — 14 gün yazılır, gerisi sayılır', () => {
    const cok = Array.from({ length: 20 }, (_, i) => ci('m1', `2026-09-${String(i + 1).padStart(2, '0')}T08:00:00Z`))
    expect(buildCheckins(cok, members).summary).toContain('+6 gün daha')
  })

  it('kayıt yoksa ve silinmiş üye', () => {
    expect(buildCheckins([], members).summary).toBe('Bu aralıkta check-in yok.')
    expect(buildCheckins([ci('mX', '2026-09-15T08:00:00Z')], members).table.rows[0]?.[0]).toBe('Silinmiş üye')
  })
})
