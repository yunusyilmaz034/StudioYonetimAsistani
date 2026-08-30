import { describe, expect, it } from 'vitest'

import { mesajZamani } from './mesaj-zamani'

// WHY THIS FILE EXISTS.
//
// The dock printed a bare time — `11:34` — for every conversation, so two rows side by side gave no
// way to tell this morning from last week. That is the first question anyone asks of that list.
//
// The rule these tests hold down: recent gets a DAY NAME, older gets a DATE, and both keep the clock
// because inside one day the clock is what orders them.

const GUN = 86_400_000
// 2026-08-30 12:00 TRT — bir pazar.
const SIMDI = Date.parse('2026-08-30T09:00:00Z')

describe('mesajZamani', () => {
  it('bugünün mesajı gün adıyla gelir', () => {
    expect(mesajZamani(SIMDI - 60_000, SIMDI)).toMatch(/^Paz \d{2}:\d{2}$/)
  })

  it('üç gün öncesi hâlâ gün adıyla — hafta içindeyse tarih gösterilmez', () => {
    expect(mesajZamani(SIMDI - 3 * GUN, SIMDI)).toMatch(/^[A-Za-zÇĞİÖŞÜçğıöşü]{3,4} \d{2}:\d{2}$/)
  })

  it('yedi günden eskisi TARİHE düşer', () => {
    // Sınır tam burada: 7 gün "yakın", 8 gün değil.
    expect(mesajZamani(SIMDI - 8 * GUN, SIMDI)).toMatch(/^\d{2}\.\d{2} \d{2}:\d{2}$/)
  })

  it('tam yedi gün sınırı eski sayılır — sınır kapalı uçlu', () => {
    expect(mesajZamani(SIMDI - 7 * GUN, SIMDI)).toMatch(/^\d{2}\.\d{2} \d{2}:\d{2}$/)
  })

  it('gelecekteki bir damga "gün önce" gibi okunmaz', () => {
    // Bozuk bir kayıt ya da saat kayması listeyi yanlış sıralatmasın; saatle geçiyoruz.
    expect(mesajZamani(SIMDI + 60_000, SIMDI)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('geçersiz damga boş döner, "01.01" yazmaz', () => {
    expect(mesajZamani(0, SIMDI)).toBe('')
    expect(mesajZamani(Number.NaN, SIMDI)).toBe('')
  })
})
