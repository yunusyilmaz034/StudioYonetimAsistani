import { describe, expect, it } from 'vitest'

import { productFromFirestore, productToFirestore } from './mappers'
import type { Product } from '../domain/types'
import type { ProductId, ServiceId, StudioId } from '../../../shared'

// EŞLEYİCİ ALANLARI TEK TEK SAYIYOR (2026-09-16). `aiQuotable` eklendiğinde tip kontrolü geçti, testler geçti, panel
// çalıştı — ama alan yazılırken düşüyordu: ürün kaydedildi, bayrak kayboldu ve kimse hata görmedi. Sessiz kayıp,
// yalnızca gidiş-dönüş bir testle yakalanır.
const urun = (over: Partial<Product> = {}): Product => ({
  id: 'prd_1' as ProductId,
  studioId: 'std_1' as StudioId,
  name: 'Fitness - 1 Aylık',
  category: 'fitness',
  serviceIds: ['svc_1' as ServiceId],
  type: 'period',
  durationDays: 30,
  creditCount: null,
  priceInKurus: 440_000,
  cashPriceInKurus: 400_000,
  freezeAllowanceDays: 0,
  dailyReservationLimit: null,
  cancellationAllowanceCount: null,
  activeReservationLimit: null,
  entryAllowance: null,
  components: null,
  description: '',
  active: true,
  onlineSellable: false,
  memberSellable: false,
  ...over,
})

describe('ürün eşleyicisi — AI fiyat bayrağı', () => {
  it('kapalı bayrak yazılır ve aynen geri okunur', () => {
    const doc = productToFirestore(urun({ aiQuotable: false }))
    expect(doc.aiQuotable).toBe(false)
    expect(productFromFirestore('prd_1' as ProductId, doc).aiQuotable).toBe(false)
  })
  it('bayrak verilmemişse AÇIK yazılır — yokluk ile kapatma karışmasın', () => {
    expect(productToFirestore(urun()).aiQuotable).toBe(true)
  })
  it('alanı hiç olmayan eski belge AÇIK okunur', () => {
    const eski = productToFirestore(urun()) as Record<string, unknown>
    delete eski.aiQuotable
    expect(productFromFirestore('prd_1' as ProductId, eski).aiQuotable).toBe(true)
  })
})
