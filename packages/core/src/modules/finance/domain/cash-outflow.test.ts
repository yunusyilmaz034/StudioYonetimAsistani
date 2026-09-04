import { describe, expect, it } from 'vitest'

import { instant, money, type ActorRef, type CorrelationId, type StudioId } from '../../../shared'
import { decideWithdrawCash, type DecideContext } from './decide'
import type { CashDrawer } from './types'

// ── KASADAN PARA ÇIKIŞI (owner onayı, 2026-09-04) ───────────────────────────────────────────
//
// Finans modülünde gider tarafı hiç yoktu (DEBT-037) ve bedeli ölçüldü: Merkez Kasa 17 Temmuz'dan
// 4 Eylül'e kadar açık kaldı, beklenen bakiye 774.061 ₺'ye çıktı. Çekmecede o para yoktu — bankaya
// ve ödemelere gitmişti — ama yazacak yer olmadığı için kasa kapanamadı.
//
// Testlerin ağırlığı REDDEDİLENLERDE: para çıkarmak kolaydır, çıkarılMAMASI gereken durumları
// bilmek zordur.

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' } as unknown as ActorRef,
  now: instant(1_800_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'staff',
}

const kasa = (expected: number, status: 'open' | 'closed' = 'open'): CashDrawer =>
  ({
    id: 'drw_1',
    studioId: 'std_1',
    branchId: 'brn_1',
    name: 'Merkez Kasa',
    kind: 'cash',
    status,
    openingFloat: money(0),
    expected: money(expected),
    active: true,
  }) as unknown as CashDrawer

const input = { outflowId: 'cof_1', category: 'bank_deposit' as const, amount: money(70_000_00), reason: 'Bankaya yatırıldı' }

describe('kasadan para çıkışı', () => {
  it('kasayı düşürür ve olayı sebebiyle yazar', () => {
    const r = decideWithdrawCash(ctx, kasa(100_000_00), input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.expected.amount).toBe(30_000_00)
    expect(r.value.outflow.reason).toBe('Bankaya yatırıldı')
    expect(r.value.outflow.voided).toBe(false)
    expect(r.value.events[0]?.payload).toMatchObject({ category: 'bank_deposit', reason: 'Bankaya yatırıldı' })
  })

  it('KAPALI kasadan para çıkmaz — sayılmış bir kasayı sonradan değiştirmek o sayımı yalan yapar', () => {
    const r = decideWithdrawCash(ctx, kasa(100_000_00, 'closed'), input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('drawer_not_open')
  })

  it('KASADA OLANDAN FAZLASI çıkmaz — fark ileri bir tarihe taşınmaz', () => {
    const r = decideWithdrawCash(ctx, kasa(50_000_00), input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('drawer_insufficient')
  })

  it('SINIR: kasadaki tutarın TAMAMI çıkabilir, bir kuruş fazlası çıkamaz', () => {
    expect(decideWithdrawCash(ctx, kasa(70_000_00), input).ok).toBe(true)
    expect(decideWithdrawCash(ctx, kasa(70_000_00 - 1), input).ok).toBe(false)
  })

  it('SIFIR ya da EKSİ tutar reddedilir — eksi bir çıkış, adı konmamış bir giriştir', () => {
    for (const a of [0, -1, -10_000]) {
      const r = decideWithdrawCash(ctx, kasa(100_000_00), { ...input, amount: money(a) })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('invalid_amount')
    }
  })

  it('SEBEPSİZ çıkmaz — boşluk da sebep değildir', () => {
    for (const reason of ['', '   ', '\n']) {
      const r = decideWithdrawCash(ctx, kasa(100_000_00), { ...input, reason })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('reason_required')
    }
  })

  it('sebep kırpılarak yazılır — baştaki boşluk defterde durmaz', () => {
    const r = decideWithdrawCash(ctx, kasa(100_000_00), { ...input, reason: '  Buse Hoca ödemesi  ' })
    if (!r.ok) return
    expect(r.value.outflow.reason).toBe('Buse Hoca ödemesi')
  })
})
