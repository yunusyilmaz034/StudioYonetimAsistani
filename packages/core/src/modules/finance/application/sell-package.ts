import {
  money,
  newOperationId,
  zeroMoney,
  type BranchId,
  type DomainError,
  type EntitlementId,
  type Instant,
  type Money,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  assignSubscription,
  type AssignSubscriptionInput,
  type EntitlementsDeps,
} from '../../entitlements'
import { decideCreateSale, decideReceivePayment } from '../domain/decide'
import type { PaymentMethod } from '../domain/types'
import { dctx, sell } from './finance'
import type { FinanceDeps } from './ports'

// SATIŞ — the package and its money, as ONE act (Alpha Review, 2026-07-13).
//
// ── The defect this exists to fix ───────────────────────────────────────────────────────────
// Until now there were **two money models running at once**, and the product wrote to one while the
// owner read the other:
//
//   what reception's screen wrote  →  `entitlement.paidTotal` / `manualPayment`   (v1.14)
//   what the owner actually reads  →  Sale · Payment · Allocation                  (v1.24)
//                                     — the dashboard, the sales report, the collections report,
//                                       the kasa, the cari hesap. All of them.
//
// So a package sold on the screen for 3.000 ₺ in cash produced: dashboard revenue **0**, sales report
// **empty**, collections report **empty**, kasa **empty**. The money existed only on the entitlement,
// where nothing the owner opens ever looks. Proven against the emulator before this was written.
//
// The ledger is now the ONE truth. A sale is a sale, and it is recorded where sales are recorded.
//
// ── The order, and why it is this way round ─────────────────────────────────────────────────
// Two aggregates, two transactions. Firestore will not commit them together without dragging one
// module's documents through the other's repository, and that boundary is worth more than the
// convenience. So one of them lands first, and the choice is between two failure states:
//
//   sale first, grant fails  → she PAID and has NO PACKAGE. Nothing on any screen says so. Silent.
//   grant first, sale fails  → she HAS THE PACKAGE and appears to OWE the full price. Loud, on the
//                              dashboard ("bekleyen ödemeler"), and reception fixes it by recording
//                              the payment she already took.
//
// **The grant goes first.** A visible, repairable wrong state beats an invisible one, always.
//
// And the window is made as small as it can be: every decider runs FIRST, against the real drawer, so
// a sale that would be refused is refused **before** anything is written. What is left is the
// vanishing case where the drawer is closed by someone else in the milliseconds between the two
// commits. `pnpm migrate:reconcile` finds it; DEBT-027 records it.

export interface SellPackageDeps {
  readonly finance: FinanceDeps
  readonly entitlements: EntitlementsDeps
}

export interface SellPackagePayment {
  readonly amount: Money
  readonly method: PaymentMethod
  readonly receivedAt: Instant
  readonly drawerId: string | null
  readonly giftCardCode: string | null
  readonly note: string | null
  // Plus Phase 6 — the provider reference when this was collected online (PAYTR). null for cash/manual.
  readonly providerRef?: string | null
}

export interface SellPackageInput {
  readonly branchId: BranchId
  /** Everything the package itself needs. Its `collectedAmount` is IGNORED — money lives in the ledger. */
  readonly subscription: AssignSubscriptionInput
  /** `null` ⇒ sold on account. Legal, and the dashboard is built to surface the debt. */
  readonly payment: SellPackagePayment | null
  readonly discountCeilingPercent: number | null
}

export async function sellPackage(
  deps: SellPackageDeps,
  ctx: TenantContext,
  input: SellPackageInput,
): Promise<Result<{ entitlementId: EntitlementId; saleId: string; paymentId: string | null }, DomainError>> {
  const operationId = newOperationId()
  const suffix = operationId.slice(4)
  const saleId = `sal_${suffix}`

  const line = {
    productId: input.subscription.productId,
    description: input.subscription.productSnapshot.name,
    quantity: 1,
    // What was AGREED — the negotiated price, which is the number the studio will be paid.
    unitPrice: input.subscription.priceAgreed,
    entitlementId: null as EntitlementId | null, // filled in once the package exists
    giftCardId: null,
  }

  // ── 1. Decide EVERYTHING first, and write nothing. ──────────────────────────────────────
  // A cash payment with no open drawer is refused HERE — before the member is given a package the
  // studio then cannot record the money for.
  const c = dctx(deps.finance, ctx, operationId)

  const draft = decideCreateSale(c, {
    saleId,
    memberId: input.subscription.memberId,
    branchId: input.branchId,
    lines: [line],
    discounts: [],
    discountCeilingPercent: input.discountCeilingPercent,
  })
  if (!draft.ok) return draft

  if (input.payment) {
    const drawer = input.payment.drawerId
      ? await deps.finance.repo.getDrawer(ctx, input.payment.drawerId)
      : null
    const card = input.payment.giftCardCode
      ? await deps.finance.repo.getGiftCardByCode(ctx, input.payment.giftCardCode)
      : null

    const check = decideReceivePayment(
      c,
      {
        paymentId: `pay_${suffix}`,
        memberId: input.subscription.memberId,
        branchId: input.branchId,
        amount: input.payment.amount,
        method: input.payment.method,
        receivedAt: input.payment.receivedAt,
        drawerId: input.payment.drawerId,
        giftCardId: card?.id ?? null,
        providerRef: input.payment.providerRef ?? null,
        note: input.payment.note,
      },
      drawer,
      card,
    )
    if (!check.ok) return check
  }

  // ── 2. The package. ─────────────────────────────────────────────────────────────────────
  // `collectedAmount` is ZERO, always: the entitlement no longer records money. It records what was
  // AGREED (`priceAgreed`, which the receipt reads) and nothing else. Two records of the same payment
  // are two answers to "has she paid?", and one of them is wrong.
  const granted = await assignSubscription(deps.entitlements, ctx, {
    ...input.subscription,
    collectedAmount: zeroMoney(),
  } satisfies AssignSubscriptionInput)
  if (!granted.ok) return granted

  // ── 3. The money, where money lives. ────────────────────────────────────────────────────
  // Same `operationId`, so the Activity Center reads it as ONE act — "Reyhan, Ayşe'ye 8 Ders Reformer
  // sattı ve 3.000 ₺ tahsil etti" — and not as three unrelated rows (OP-2).
  const sold = await sell(deps.finance, ctx, {
    saleId,
    memberId: input.subscription.memberId,
    branchId: input.branchId,
    lines: [{ ...line, entitlementId: granted.value.entitlementId }],
    discounts: [],
    discountCeilingPercent: input.discountCeilingPercent,
    operationId,
    payment: input.payment
      ? {
          paymentId: `pay_${suffix}`,
          allocationId: `alc_${suffix}`,
          amount: input.payment.amount,
          method: input.payment.method,
          receivedAt: input.payment.receivedAt,
          drawerId: input.payment.drawerId,
          giftCardCode: input.payment.giftCardCode,
          providerRef: input.payment.providerRef ?? null,
          note: input.payment.note,
        }
      : null,
  })
  if (!sold.ok) return sold

  return {
    ok: true,
    value: {
      entitlementId: granted.value.entitlementId,
      saleId: sold.value.saleId,
      paymentId: sold.value.paymentId,
    },
  }
}

/** What a member still owes, from the LEDGER — the one place money is recorded. */
export function amountDue(openSaleTotals: readonly { total: Money; paid: Money }[]): Money {
  return money(
    openSaleTotals.reduce((n, s) => n + Math.max(0, s.total.amount - s.paid.amount), 0),
  )
}
