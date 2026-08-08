import { describe, expect, it } from 'vitest'

import { maskEmail, maskName, maskPhone } from './demo-mask'

// Bir maskeleme fonksiyonunun test edilmesi gereken tek şey, MASKELEDİĞİNİ SANDIĞIMIZ ama
// maskelemediği durumdur. Gerçek adın çıktıda kalması, hiç maskelememekten kötüdür — çünkü ekrana
// güvenip görüntü paylaşılır.

describe('maskName', () => {
  it('gerçek adın hiçbir parçasını geçirmez', () => {
    const out = maskName('SAKİNE GÜMÜŞ', 'mem_1')
    expect(out).not.toContain('SAKİNE')
    expect(out).not.toContain('GÜMÜŞ')
    // Baş harf bile kalmaz: küçük bir stüdyoda "S. G." kimliği açık eder.
    expect(out.startsWith('S')).toBe(false)
  })

  it('aynı üyeye her ekranda aynı takma adı verir', () => {
    // Rastgele olsaydı aynı kişi takvimde başka, rezervasyonlarda başka görünür ve demo çökerdi.
    expect(maskName('SAKİNE GÜMÜŞ', 'mem_1')).toBe(maskName('SAKİNE GÜMÜŞ', 'mem_1'))
    expect(maskName('BAŞKA BİRİ', 'mem_1')).toBe(maskName('SAKİNE GÜMÜŞ', 'mem_1'))
  })

  it('farklı üyelere farklı takma adlar dağıtır', () => {
    const names = new Set(['mem_1', 'mem_2', 'mem_3', 'mem_4', 'mem_5'].map((id) => maskName('X', id)))
    expect(names.size).toBeGreaterThan(1)
  })

  it('boş isimde bile bir şey döndürür', () => {
    expect(maskName('', 'mem_9').length).toBeGreaterThan(0)
  })
})

describe('maskPhone', () => {
  it('son iki hane dışında hiçbir rakamı bırakmaz', () => {
    const out = maskPhone('+905455714147')
    expect(out).toBe('+90 5•• ••• •• 47')
    expect(out).not.toContain('5455')
    expect(out).not.toContain('714')
  })

  it('biçimi ne olursa olsun aynı sonucu verir', () => {
    expect(maskPhone('0545 571 41 47')).toBe(maskPhone('+90 545 571 41 47'))
  })

  it('bozuk/eksik numarada da rakam sızdırmaz', () => {
    expect(maskPhone('123')).toBe('+90 5•• ••• •• ••')
    expect(maskPhone('')).toBe('+90 5•• ••• •• ••')
  })
})

describe('maskEmail', () => {
  it('kullanıcı adını gizler, alan adını bırakır', () => {
    expect(maskEmail('ayse.gunes@gmail.com')).toBe('a•••@gmail.com')
  })

  it('e-posta olmayan bir metni tamamen gizler', () => {
    expect(maskEmail('serbest metin')).toBe('•••')
    expect(maskEmail('@bas')).toBe('•••')
  })
})
