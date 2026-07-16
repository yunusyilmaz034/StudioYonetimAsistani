import { describe, expect, it } from 'vitest'

import { MissingColumnError, readBulutGymMembers } from './import-csv'

describe('readBulutGymMembers — the BulutGym export shape', () => {
  it('reads a SINGLE "Üye / Müşteri" name column + Telefon (the real export)', () => {
    const csv = ['# ,Üye / Müşteri,Telefon,E-Posta,Durum', '1,ELİF IŞIK,5350586992,-,Üyelik Durumu : Aktif', '2,TUANA ÖZGE GÜNEY,5324426186,-,Aktif'].join('\n')
    const rows = readBulutGymMembers(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ line: 2, fullName: 'ELİF IŞIK', phoneRaw: '5350586992' })
    expect(rows[1]).toMatchObject({ fullName: 'TUANA ÖZGE GÜNEY', phoneRaw: '5324426186' })
  })

  it('still reads separate ad + soyad columns (backward compatible)', () => {
    const rows = readBulutGymMembers('ad;soyad;telefon\nElif;Işık;5350586992')
    expect(rows[0]).toMatchObject({ fullName: 'Elif Işık', phoneRaw: '5350586992' })
  })

  it('folds Turkish accents in the header (Müşteri, Telefon) and a UTF-8 BOM', () => {
    const rows = readBulutGymMembers('﻿Üye / Müşteri,Telefon\nAyşe Yılmaz,5551112233')
    expect(rows[0]?.fullName).toBe('Ayşe Yılmaz')
  })

  it('throws a named error naming the columns it DID find when name is absent', () => {
    expect(() => readBulutGymMembers('Kod,Telefon\nX,555')).toThrow(MissingColumnError)
    try {
      readBulutGymMembers('Kod,Adres\nX,Y')
    } catch (e) {
      expect((e as Error).message).toContain('Bulunan sütunlar: Kod | Adres')
    }
  })
})
