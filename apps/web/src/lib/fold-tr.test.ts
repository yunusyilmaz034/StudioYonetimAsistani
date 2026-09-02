import { describe, expect, it } from 'vitest'

import { foldTr } from './fold-tr'

// Bu testin sebebi bir "Sonuç yok" ekranı: owner ⌘K'ya "ebru kılıç" yazdı, üye "EBRU KILIÇ" olarak
// kayıtlıydı, arama boş döndü. Aşağıdaki ilk vaka o gün.

describe('Türkçe arama katlaması', () => {
  it('noktalı ve noktasız i, hangi yönde yazılırsa yazılsın eşleşir', () => {
    // `"EBRU KILIÇ".toLowerCase()` "ebru kiliç" verir — noktalı i. Aranan ise "kılıç".
    expect(foldTr('EBRU KILIÇ')).toBe(foldTr('ebru kılıç'))
    expect(foldTr('EBRU KILIÇ')).toBe(foldTr('Ebru Kilic'))
    expect(foldTr('İSMAİL')).toBe(foldTr('ismail'))
    expect(foldTr('IŞIL')).toBe(foldTr('ışıl'))
  })

  it('aksan aranırken yazılmak zorunda değil — resepsiyon telefonla konuşurken yazmıyor', () => {
    expect(foldTr('GÜLNARE')).toBe(foldTr('gulnare'))
    expect(foldTr('ÖZGE')).toBe(foldTr('ozge'))
    expect(foldTr('ŞENGÜL')).toBe(foldTr('sengul'))
    expect(foldTr('ÇAĞLA')).toBe(foldTr('cagla'))
  })

  it('parça arama çalışır — kullanıcı adın tamamını yazmıyor', () => {
    expect(foldTr('SEBAHAT SALKIM').includes(foldTr('salkım'))).toBe(true)
    expect(foldTr('TUĞBA ŞARDAN').includes(foldTr('tugba'))).toBe(true)
  })

  it('ayırt etmesi gerekeni ayırt eder — her şeyi aynı yapmıyor', () => {
    expect(foldTr('ELİF')).not.toBe(foldTr('ELMA'))
    expect(foldTr('ayşe')).not.toBe(foldTr('ayse nur'))
  })
})
