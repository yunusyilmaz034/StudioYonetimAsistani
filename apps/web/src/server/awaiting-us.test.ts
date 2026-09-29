import { describe, expect, it } from 'vitest'

import { bekleyenSoz, donusSozu } from './awaiting-us'

// Bu kural, stüdyonun MÜŞTERİYE VERDİĞİ SÖZÜ yakalıyor. Yanlış yakalamanın iki yönü de pahalı:
// kaçırırsan müşteri bekler ve kimse bilmez (owner'ın bildirdiği vaka), fazla yakalarsan pano
// her sohbeti iş diye gösterir ve okunmaz hale gelir.

const NOW = Date.parse('2026-09-29T10:00:00+03:00')
const once = (dk: number) => NOW - dk * 60_000

describe('donusSozu', () => {
  it('AI’ın gerçekten kurduğu cümleleri yakalar', () => {
    expect(donusSozu('Anladım Neslihan Hanım, hemen kontrol edip size dönelim 🌸')).toBe(true)
    expect(donusSozu('En kısa sürede size dönüş yapacağız, kendinize iyi bakın 💛')).toBe(true)
    expect(donusSozu('Kontrol edip size döneceğiz 🌸')).toBe(true)
    expect(donusSozu('Resepsiyonumuza iletelim, en kısa sürede ilgilensinler')).toBe(true)
    expect(donusSozu('Not aldım, teşekkürler')).toBe(true)
    expect(donusSozu('Bulur bulmaz haber vereceğiz')).toBe(true)
  })

  it('BÜYÜK HARFLE yazılmış olanı da yakalar — İ ve I katlanmadan eşleşmez', () => {
    expect(donusSozu('SİZE DÖNÜŞ YAPACAĞIZ')).toBe(true)
    expect(donusSozu('NOT ALDIM')).toBe(true)
  })

  it('söz olmayan cümleleri yakalamaz', () => {
    expect(donusSozu('Aylık paketimiz 4.500 ₺, haftada iki ders 🌸')).toBe(false)
    expect(donusSozu('Bu konu için 0533 199 41 23 numaralı hattımıza yazmanız yeterli')).toBe(false)
    expect(donusSozu('Rica ederiz, iyi günler dileriz')).toBe(false)
    // "dönem" ve "dönüyor" bir taahhüt değil — kalıbın en olası yanlış eşleşmesi bu.
    expect(donusSozu('Yaz döneminde programımız değişiyor')).toBe(false)
    expect(donusSozu('Reformer dersi haftada iki gün dönüyor')).toBe(false)
  })
})

describe('bekleyenSoz', () => {
  const soz = { role: 'assistant', text: 'Kontrol edip size dönelim 🌸', at: once(90) }

  it('son söz bizdeyse ve bir vaat taşıyorsa iştir', () => {
    expect(bekleyenSoz({ status: 'ai', messages: [{ role: 'user', text: 'kod gelmedi', at: once(95) }, soz] }, NOW)).toEqual({
      text: soz.text,
      at: soz.at,
    })
  })

  it('biri devraldıysa susar — ikinci hatırlatma gürültüdür', () => {
    expect(bekleyenSoz({ status: 'human', messages: [soz] }, NOW)).toBeNull()
  })

  it('zaten "operatör bekliyor" işareti varsa susar — aynı iş iki kez listelenmez', () => {
    expect(bekleyenSoz({ status: 'ai', needsAttention: true, messages: [soz] }, NOW)).toBeNull()
  })

  it('son söz müşterideyse bu başka bir iştir', () => {
    expect(bekleyenSoz({ status: 'ai', messages: [soz, { role: 'user', text: 'peki ne zaman?', at: once(10) }] }, NOW)).toBeNull()
  })

  it('vaat içermeyen bir cevap iş açmaz', () => {
    expect(bekleyenSoz({ status: 'ai', messages: [{ role: 'assistant', text: 'Aylık paket 4.500 ₺ 🌸', at: once(90) }] }, NOW)).toBeNull()
  })

  it('boş ya da geleceğe tarihli bir kayda güvenmez', () => {
    expect(bekleyenSoz({ status: 'ai', messages: [{ role: 'assistant', text: '', at: once(90) }] }, NOW)).toBeNull()
    expect(bekleyenSoz({ status: 'ai', messages: [{ role: 'assistant', text: 'dönelim', at: NOW + 60_000 }] }, NOW)).toBeNull()
    expect(bekleyenSoz({ status: 'ai', messages: [] }, NOW)).toBeNull()
    expect(bekleyenSoz({ status: 'ai' }, NOW)).toBeNull()
  })
})
