import { money, type MemberId, type Money, type TenantContext } from '../../../shared'
import { saleBalanceDue, type PaymentMethod } from '../domain/types'
import type { FinanceDeps } from './ports'

// WHAT A PACKAGE COST, AND WHAT WAS PAID FOR IT — read from the LEDGER (Alpha Review, 2026-07-13).
//
// The entitlement used to answer this from its own `paidTotal` / `manualPayment` fields. That was the
// second money model, and it is gone: money is recorded once, in the ledger, and every screen that
// asks "has she paid?" now asks the same place. Two records of one payment are two answers, and one
// of them is wrong — usually the one on the screen the member is looking at.
//
// The join is the sale LINE: `SaleLine.entitlementId` says which package this money bought. That
// field has existed since v1.24, waiting for exactly this.

export interface EntitlementMoney {
  readonly saleId: string
  /** What was agreed — the sale's total, which is what the studio is owed for this package. */
  readonly agreed: Money
  readonly paid: Money
  /** `agreed − paid`. Selling without collecting is legal here; the debt must never be invisible. */
  readonly due: Money
  /** How she paid, when she has. `null` ⇒ nothing collected yet. */
  readonly method: PaymentMethod | null
  readonly cancelled: boolean
}

/**
 * Every package this member bought, with its money. Three reads, bounded by one member's history.
 *
 * Keyed by entitlement id, so a screen holding entitlements can join without a query per row.
 */
export async function moneyByEntitlement(
  deps: FinanceDeps,
  ctx: TenantContext,
  memberId: MemberId,
): Promise<Map<string, EntitlementMoney>> {
  const [sales, allocations, payments] = await Promise.all([
    deps.repo.listSalesByMember(ctx, memberId),
    deps.repo.listAllocationsByMember(ctx, memberId),
    deps.repo.listPaymentsByMember(ctx, memberId),
  ])

  const methodOf = new Map(payments.filter((p) => !p.voided).map((p) => [p.id, p.method]))
  const bySale = new Map<string, PaymentMethod>()
  for (const a of allocations) {
    const m = methodOf.get(a.paymentId)
    // The FIRST method that settled this sale. A sale paid half in cash and half by card is rare
    // enough that naming the first is honest and naming both is noise.
    if (m && !bySale.has(a.saleId)) bySale.set(a.saleId, m)
  }

  const out = new Map<string, EntitlementMoney>()
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (!line.entitlementId) continue // a gift card, a fee — not a package
      out.set(line.entitlementId as string, {
        saleId: sale.id,
        agreed: sale.total,
        paid: sale.paid,
        due: money(saleBalanceDue(sale)),
        method: bySale.get(sale.id) ?? null,
        cancelled: sale.status === 'cancelled',
      })
    }
  }
  return out
}

/** What the whole studio is owed, per member — from the open sales. One read, bounded by the debt. */
export async function debtByMember(
  deps: FinanceDeps,
  ctx: TenantContext,
): Promise<Map<string, Money>> {
  const open = await deps.repo.listOpenSales(ctx)
  const out = new Map<string, number>()
  for (const s of open) {
    const due = saleBalanceDue(s)
    if (due <= 0) continue
    out.set(s.memberId as string, (out.get(s.memberId as string) ?? 0) + due)
  }
  return new Map([...out].map(([id, kurus]) => [id, money(kurus)]))
}
