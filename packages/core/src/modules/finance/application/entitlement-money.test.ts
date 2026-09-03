import { describe, expect, it } from 'vitest'

import { money, type MemberId, type TenantContext } from '../../../shared'
import type { Sale } from '../domain/types'
import { moneyByEntitlement } from './entitlement-money'
import type { FinanceDeps, FinanceRepository } from './ports'

const ctx = { studioId: 'std_1', actor: { type: 'owner', id: 'usr_1' } } as unknown as TenantContext
const MEMBER = 'mbr_1' as MemberId

/** A ₺5.000 package with ₺800 given away and ₺4.200 collected — the shape that produced this test. */
function saleWith(
  discountKurus: number,
  paidKurus: number,
  entitlementIds: readonly string[],
  correctedKurus = 0,
): Sale {
  return {
    id: 'sal_1',
    lines: entitlementIds.map((entitlementId) => ({ entitlementId, unitPrice: money(500000), quantity: 1 })),
    discounts: discountKurus > 0 ? [{ reason: 'gift', amount: money(discountKurus), note: '' }] : [],
    discountCorrections:
      correctedKurus > 0 ? [{ reason: 'wrong_amount', amount: money(correctedKurus), note: 'düzeltme' }] : [],
    gross: money(500000),
    total: money(500000 - discountKurus),
    paid: money(paidKurus),
    status: 'settled',
  } as unknown as Sale
}

function deps(sale: Sale): FinanceDeps {
  const repo = {
    listSalesByMember: async () => [sale],
    listAllocationsByMember: async () => [],
    listPaymentsByMember: async () => [],
  } as unknown as FinanceRepository
  return { repo } as unknown as FinanceDeps
}

// ── The screen showed three numbers that did not add up (2026-08-10) ────────────────────────
// "Paket tutarı 5.000 · Tahsil edilen 4.200 · Kalan borç —". Every one of them was correct: the
// first is the entitlement's own price (before the discount), the other two come from the sale
// (after it). What was missing was the discount that bridges them, so a settled package read as a
// package whose debt had gone missing — and the owner went looking for a broken feature.
describe('moneyByEntitlement — the discount is reported, not just applied', () => {
  it('reports what was given away, so price − discount − paid reconciles to the balance', async () => {
    const out = await moneyByEntitlement(deps(saleWith(80000, 420000, ['ent_1'])), ctx, MEMBER)
    const m = out.get('ent_1')!

    expect(m.discount.amount).toBe(80000)
    expect(m.paid.amount).toBe(420000)
    expect(m.due.amount).toBe(0) // 5.000 − 800 − 4.200
    // The number the screen prints as "Paket tutarı" comes from the entitlement, not from here; the
    // point is that gross − discount is what the rest of this record is measured against.
    expect(m.agreed.amount + m.discount.amount).toBe(500000)
  })

  it('is zero — not absent — when nothing was discounted', async () => {
    // A row that renders on `> 0` must be able to trust the number. `undefined` would render nothing
    // either, but only by accident, and the accident stops working the day the check changes.
    const out = await moneyByEntitlement(deps(saleWith(0, 500000, ['ent_1'])), ctx, MEMBER)
    expect(out.get('ent_1')!.discount.amount).toBe(0)
  })

  it('reports the SALE\'s discount on every component of a hybrid', async () => {
    // A discount is granted on the sale, never on one of its lines — the same rule `paid` and `due`
    // already follow here. The screen groups a bundle's components and shows the group once, so
    // repeating the figure per component is what keeps that grouping honest.
    const out = await moneyByEntitlement(deps(saleWith(80000, 420000, ['ent_1', 'ent_2'])), ctx, MEMBER)
    expect(out.get('ent_1')!.discount.amount).toBe(80000)
    expect(out.get('ent_2')!.discount.amount).toBe(80000)
  })

  it('reports the discount NET of what was taken back', async () => {
    // ₺1.000 granted by mistake, ₺200 reversed → the screen must say ₺800, not the figure reception
    // mistyped. The grant stays on the sale (it is a compensating entry, not an edit); the netting
    // happens here, where the screen reads.
    const out = await moneyByEntitlement(deps(saleWith(100_000, 400_000, ['ent_1'], 20_000)), ctx, MEMBER)
    expect(out.get('ent_1')!.discount.amount).toBe(80_000)
  })
})

// ── İPTAL EDİLMİŞ SATIŞ, CANLI OLANIN ÜSTÜNE YAZMAZ (owner, 2026-09-03) ─────────────────────
//
// Para düzeltmesinin şekli sabittir: yanlış satış iptal edilir, doğrusu AYNI aboneliğe kurulur. O
// abonelik böylece iki satışta geçer, ve buranın map'i son yazana teslim oluyordu. Sonuç ekranda
// şuydu: "Paket tutarı 9.500 · Tahsil edilen 0 · Kalan bakiye 0" — üye ödemişken.
//
// İki yön de test ediliyor, çünkü hatanın sebebi SIRAYDI: canlı satış önce gelirse de sonra gelirse
// de sonuç aynı olmalı.
describe('cancelled sale never overwrites a live one', () => {
  const enement = 'ent_1'
  const sale = (id: string, status: 'settled' | 'cancelled', total: number, paid: number) => ({
    id,
    studioId: 'st' as never,
    branchId: 'br' as never,
    memberId: 'mem_1' as never,
    lines: [{ productId: 'p1' as never, description: 'x', quantity: 1, unitPrice: money(total), entitlementId: enement as never, giftCardId: null }],
    discounts: [],
    gross: money(total),
    total: money(total),
    paid: money(paid),
    status,
    soldBy: { type: 'system', id: 's' } as never,
    soldAt: 0 as never,
    cancelledAt: null,
    cancelReason: null,
  })

  const run = async (sales: unknown[]) =>
    moneyByEntitlement(
      {
        repo: {
          listSalesByMember: async () => sales,
          listAllocationsByMember: async () => [],
          listPaymentsByMember: async () => [],
        },
        clock: { now: () => 0 as never },
      } as never,
      { studioId: 'st' } as never,
      'mem_1' as never,
    )

  it('iptal edilmiş satış SONRA gelse bile canlı olan kazanır', async () => {
    const m = await run([sale('live', 'settled', 950_000, 950_000), sale('old', 'cancelled', 850_000, 0)])
    expect(m.get(enement)?.paid.amount).toBe(950_000)
    expect(m.get(enement)?.agreed.amount).toBe(950_000)
    expect(m.get(enement)?.cancelled).toBe(false)
  })

  it('iptal edilmiş satış ÖNCE gelse de sonuç aynı', async () => {
    const m = await run([sale('old', 'cancelled', 850_000, 0), sale('live', 'settled', 950_000, 950_000)])
    expect(m.get(enement)?.paid.amount).toBe(950_000)
    expect(m.get(enement)?.cancelled).toBe(false)
  })

  it('gerçekten iptal edilmiş bir paket hâlâ görünür — gizlenmez', async () => {
    const m = await run([sale('only', 'cancelled', 850_000, 0)])
    expect(m.get(enement)?.cancelled).toBe(true)
  })
})
