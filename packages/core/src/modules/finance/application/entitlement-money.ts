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
  /**
   * Σ of the sale's discounts. Zero for almost every sale, and the reason it is here at all: the
   * package screen shows the entitlement's own price (BEFORE any discount) next to the sale's paid
   * and due (AFTER it). Without this number those three lines do not add up, and the owner reads
   * "5.000 agreed · 4.200 collected · no debt" as a fault in the software rather than as the
   * discount she granted.
   *
   * It is also the point of recording discounts at all: a studio that cannot count what it gave
   * away cannot decide whether to keep giving it (OR-32).
   */
  readonly discount: Money
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

  // İPTAL EDİLMİŞ BİR SATIŞ, CANLI OLANIN ÜSTÜNE YAZMAZ (owner, 2026-09-03).
  //
  // Bir paketin parası düzeltildiğinde yol hep aynı: yanlış satış SEBEBİYLE İPTAL edilir, doğrusu
  // aynı `entitlementId`ye kurulur (#9 — düzeltme sessiz bir üzerine yazma değil, telafi kaydıdır).
  // Böylece o abonelik İKİ satışta geçer, ve burası bir map'e `set` ediyordu: son yazan kazanıyordu.
  // Sıra `listSalesByMember`ın sırasıdır, yani iptal edilmiş satış sona düştüğünde paket kartı ONU
  // okuyordu — **"Paket tutarı 9.500 · Tahsil edilen 0 · Kalan bakiye 0"**, üye parayı ödemişken.
  //
  // Ölçüldü (2026-09-03): altı paket bu durumdaydı ve DÖRDÜ günler öncesinden — SAKİNE, ESRA, SELMA,
  // EBRU. Yani hata her para düzeltmesinde sessizce oluşuyordu ve kimse fark etmemişti; fark edilmesi
  // için birinin kartı o gün açması gerekti.
  //
  // Kural: bir abonelik için CANLI satış varsa o kazanır. İptal edilmiş satış yalnızca başka satış
  // yoksa yazılır — gerçekten iptal edilmiş bir paket de görünmeye devam etsin (`cancelled: true`).
  const out = new Map<string, EntitlementMoney>()
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (!line.entitlementId) continue // a gift card, a fee — not a package
      const varOlan = out.get(line.entitlementId as string)
      if (varOlan && !varOlan.cancelled && sale.status === 'cancelled') continue
      out.set(line.entitlementId as string, {
        saleId: sale.id,
        agreed: sale.total,
        paid: sale.paid,
        // Sale-level, like `paid` and `due` beside it: a discount is granted on the sale, not on one
        // of its lines. A hybrid's components therefore each report the bundle's discount, which is
        // the same shape the screen already groups them under.
        //
        // NET of corrections. A discount taken back (2026-08-11) is a compensating entry rather than
        // an edit, so the grant is still on the sale — reporting the gross here would show the ₺1.000
        // reception mistyped for ever, which is the number the correction exists to stop showing.
        discount: money(
          sale.discounts.reduce((sum, d) => sum + d.amount.amount, 0) -
            (sale.discountCorrections ?? []).reduce((sum, c) => sum + c.amount.amount, 0),
        ),
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

/**
 * PAKET BAŞINA AÇIK BAKİYE, bütün stüdyo için — tek okuma (owner, 2026-09-02).
 *
 * `debtByMember` ÜYE başına topluyor. Üyelik raporunda o toplam, satırda adı yazan paketin yanına
 * geliyordu — ve iki paketi olan bir üyede satırdaki hiçbir şey aynı pakete ait olmuyordu: paket
 * eskisinin, bakiye yenisinin. Doğru okunan ama yanlış olan bir satır.
 *
 * Aynı `listOpenSales` okumasından çıkıyor, yani ek maliyet yok. Anahtar `SaleLine.entitlementId`.
 * Bir demet (hibrit) satışında her bileşen satışın borcunu bildirir — üye ekranındaki tek kartın
 * gösterdiği rakamın aynısı.
 */
export async function debtByEntitlement(deps: FinanceDeps, ctx: TenantContext): Promise<Map<string, Money>> {
  const open = await deps.repo.listOpenSales(ctx)
  const out = new Map<string, number>()
  for (const s of open) {
    const due = saleBalanceDue(s)
    if (due <= 0) continue
    for (const line of s.lines) {
      if (!line.entitlementId) continue
      out.set(line.entitlementId as string, due)
    }
  }
  return new Map([...out].map(([id, kurus]) => [id, money(kurus)]))
}
