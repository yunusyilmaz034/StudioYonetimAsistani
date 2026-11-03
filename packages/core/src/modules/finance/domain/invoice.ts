import { err, money, ok, type ActorRef, type DomainError, type Instant, type MemberId, type Money, type NewEvent, type PaymentId, type Result, type StudioId } from '../../../shared'
import { INVOICE_ISSUED, INVOICE_REVERTED } from '../events'
import type { DecideContext, Outcome } from './decide'
import type { Payment } from './types'

/**
 * FATURA İŞARETİ (owner, 2026-11-03). One per payment, keyed by the payment id. ABSENT means "not
 * invoiced yet" — there is no row to backfill for the thousands of payments that came before.
 *
 * Kept OUT of the payment document on purpose: a payment is never mutated (I-31), and "we cut the
 * invoice" is a fact about the paperwork, not about the money.
 */
export interface InvoiceMark {
  readonly paymentId: string
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly issued: boolean
  readonly issuedAt: Instant | null
  readonly issuedBy: ActorRef | null
  /** Free text — "e-arşiv 2026-118" or whatever the desk writes. State only, never in an event. */
  readonly note: string | null
  /**
   * The amount the invoice was cut for, as the desk typed it (owner, 2026-11-03). Recorded, not judged:
   * it may differ from the payment. null on a reverted mark.
   */
  readonly invoicedAmount: Money | null
}

const base = (ctx: DecideContext, payment: Payment): Omit<NewEvent, 'type' | 'payload'> => ({
  studioId: ctx.studioId,
  branchId: payment.branchId,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'payment' as const, id: payment.id },
  related: { memberId: payment.memberId, paymentId: payment.id as PaymentId },
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

/** Tick: the invoice for this payment has been cut. A voided payment has nothing to invoice. */
export function decideIssueInvoice(
  ctx: DecideContext,
  payment: Payment,
  current: InvoiceMark | null,
  note: string | null,
  invoicedKurus: number,
): Result<Outcome<InvoiceMark>, DomainError> {
  if (payment.voided) return err({ code: 'operation_not_applicable' })
  if (current?.issued) return err({ code: 'operation_not_applicable' })
  // Money is an integer of kuruş (#10); an invoice of nothing is not an invoice.
  if (!Number.isInteger(invoicedKurus) || invoicedKurus <= 0) return err({ code: 'invalid_amount' })
  const invoicedAmount = money(invoicedKurus)
  const trimmed = note?.trim() ? note.trim() : null
  return ok({
    next: {
      paymentId: payment.id,
      studioId: payment.studioId,
      memberId: payment.memberId,
      issued: true,
      issuedAt: ctx.now,
      issuedBy: ctx.actor,
      note: trimmed,
      invoicedAmount,
    },
    events: [
      {
        ...base(ctx, payment),
        type: INVOICE_ISSUED,
        payload: { amount: payment.amount, invoicedAmount, method: payment.method, receivedAt: payment.receivedAt },
      },
    ],
  })
}

/** Un-tick: a correction, so it says why (#9). The note stays — it may explain the mistake. */
export function decideRevertInvoice(
  ctx: DecideContext,
  payment: Payment,
  current: InvoiceMark | null,
  reason: string,
): Result<Outcome<InvoiceMark>, DomainError> {
  if (!current?.issued) return err({ code: 'operation_not_applicable' })
  if (reason.trim() === '') return err({ code: 'reason_required' })
  return ok({
    next: { ...current, issued: false, issuedAt: null, issuedBy: null, invoicedAmount: null },
    events: [{ ...base(ctx, payment), type: INVOICE_REVERTED, payload: { reason: reason.trim() } }],
  })
}

// ── HAVALE/EFT: 7 GÜN (owner, 2026-11-03) ──────────────────────────────────────────────────────
//
// *"EFT ve havaleleri özellikle 7 gün dolmadan kesmek istiyoruz; 7 gün dolmadan bana mail at."*
// The legal window for an invoice is seven days. Which transfers are inside their last three days, or
// already past, without a tick — the list the morning e-mail carries. Pure: the sweep reads, this decides.

export const INVOICE_WINDOW_DAYS = 7
/** Start warning when this many days (or fewer) are left. */
export const INVOICE_WARN_DAYS = 3
/** How far back an un-invoiced transfer keeps being reported. */
export const INVOICE_OVERDUE_LOOKBACK_DAYS = 30

export interface InvoiceDue {
  readonly paymentId: string
  readonly memberId: MemberId
  readonly receivedAt: Instant
  readonly amount: Money
  readonly dueAt: number
  /** Whole days left until `dueAt`; 0 = today is the last day; negative = overdue. */
  readonly daysLeft: number
}

const DAY = 86_400_000

export function invoicesDue(
  payments: readonly Payment[],
  issuedPaymentIds: ReadonlySet<string>,
  excludedMemberIds: ReadonlySet<string>,
  now: number,
): readonly InvoiceDue[] {
  const since = now - INVOICE_OVERDUE_LOOKBACK_DAYS * DAY
  return payments
    .filter(
      (p) =>
        p.method === 'bank_transfer' &&
        !p.voided &&
        p.receivedAt >= since &&
        !issuedPaymentIds.has(p.id) &&
        !excludedMemberIds.has(p.memberId as string),
    )
    .map((p) => {
      const dueAt = p.receivedAt + INVOICE_WINDOW_DAYS * DAY
      return { paymentId: p.id, memberId: p.memberId, receivedAt: p.receivedAt, amount: p.amount, dueAt, daysLeft: Math.floor((dueAt - now) / DAY) }
    })
    .filter((d) => d.daysLeft <= INVOICE_WARN_DAYS)
    .sort((a, b) => a.dueAt - b.dueAt)
}
