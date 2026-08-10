import { describe, expect, it } from 'vitest'

import { money, type MemberId, type TenantContext } from '../../../shared'
import type { Sale } from '../domain/types'
import { moneyByEntitlement } from './entitlement-money'
import type { FinanceDeps, FinanceRepository } from './ports'

const ctx = { studioId: 'std_1', actor: { type: 'owner', id: 'usr_1' } } as unknown as TenantContext
const MEMBER = 'mbr_1' as MemberId

/** A ₺5.000 package with ₺800 given away and ₺4.200 collected — the shape that produced this test. */
function saleWith(discountKurus: number, paidKurus: number, entitlementIds: readonly string[]): Sale {
  return {
    id: 'sal_1',
    lines: entitlementIds.map((entitlementId) => ({ entitlementId, unitPrice: money(500000), quantity: 1 })),
    discounts: discountKurus > 0 ? [{ reason: 'gift', amount: money(discountKurus), note: '' }] : [],
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
})
