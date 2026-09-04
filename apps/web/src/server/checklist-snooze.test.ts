import { describe, expect, it } from 'vitest'

import { CHECKLIST_COOLDOWN_DAYS, isSnoozedNow, kindOfItemId } from './checklist-snooze'

// Tiklenmiş bir "bir arayın" satırı, tiklendiği gün YERİNDE kalmalı (resepsiyon ne kapattığını
// görsün, ve yanlış tik geri alınabilsin) ve ertesi sabah GİTMELİ. Bu çift, kuralın kendisidir.
//
// 2026-09-04: soğuma artık ayrı bir belgeden değil, TİKİN KENDİSİNDEN türetiliyor. Sebebi burada
// test ediliyor — yeni bir tür listeye eklendiğinde GEÇMİŞTE atılmış tikler de susmalı, çünkü
// soğumanın dayanağı "tik anında ne biliyorduk" değil, "bu iş yapıldı mı".
const T = (iso: string) => new Date(iso).getTime()
const LEAD = 'wa:+905321234567'
const UZAK = 'dormant_member__mem_1'
const SEANS = 'empty_session__ses_1'

describe('checklist soğuması', () => {
  const at = T('2026-09-03T13:00:00+03:00')

  it('tiklendiği gün listede kalır — üstü çizili, geri alınabilir', () => {
    expect(isSnoozedNow(UZAK, at, T('2026-09-03T13:00:01+03:00'))).toBe(false)
    expect(isSnoozedNow(UZAK, at, T('2026-09-03T23:59:59+03:00'))).toBe(false)
  })

  it('ertesi sabah listeden çıkar', () => {
    expect(isSnoozedNow(UZAK, at, T('2026-09-04T00:00:01+03:00'))).toBe(true)
    expect(isSnoozedNow(UZAK, at, T('2026-09-09T12:00:00+03:00'))).toBe(true)
  })

  it('süre dolunca geri gelir — sebep hâlâ duruyorsa iş hâlâ iştir', () => {
    expect(isSnoozedNow(UZAK, at, at + 7 * 86_400_000 + 1)).toBe(false)
  })

  it('gece yarısı sınırı STÜDYONUN saatiyle okunur', () => {
    const gece = T('2026-09-03T23:00:00+03:00')
    expect(isSnoozedNow(UZAK, gece, T('2026-09-03T23:30:00+03:00'))).toBe(false)
    expect(isSnoozedNow(UZAK, gece, T('2026-09-04T00:30:00+03:00'))).toBe(true)
  })

  it('WhatsApp lead satırı da soğur — kimlik `wa:` ile başlar', () => {
    expect(kindOfItemId(LEAD)).toBe('hot_lead')
    expect(isSnoozedNow(LEAD, at, T('2026-09-04T09:00:00+03:00'))).toBe(true)
  })

  it('GEÇMİŞTE atılmış tik de susar — soğumanın dayanağı tikin kendisidir', () => {
    // Bu, 4 Eylül'de owner'ın ikinci kez bildirdiği hatanın testi: `hot_lead` soğuması tiklerden
    // SONRA eklenmişti ve 25 lead ertesi sabah geri gelmişti. Türetme geçmişe dönük çalışır.
    const oncekiGun = T('2026-09-04T16:09:00+03:00')
    expect(isSnoozedNow(LEAD, oncekiGun, T('2026-09-05T00:04:00+03:00'))).toBe(true)
  })

  it('soğuması olmayan tür susmaz — boş seans üç saat sonra başlıyor', () => {
    expect(isSnoozedNow(SEANS, at, T('2026-09-04T09:00:00+03:00'))).toBe(false)
    expect(CHECKLIST_COOLDOWN_DAYS.empty_session).toBeUndefined()
  })

  it('tanınmayan bir kimlik biçimi soğumaz — uydurma tür, sebepsiz silinen iş demektir', () => {
    expect(kindOfItemId('garip-kimlik')).toBeNull()
    expect(isSnoozedNow('garip-kimlik', at, T('2026-09-04T09:00:00+03:00'))).toBe(false)
  })

  it('son tarihi olan işler daha kısa soğur — yanan hak geri gelmiyor', () => {
    expect(CHECKLIST_COOLDOWN_DAYS.expiring_with_credits).toBe(3)
    expect(CHECKLIST_COOLDOWN_DAYS.expiring_soon).toBe(3)
  })
})
