import { err, ok, type ActorRef, type DomainError, type Instant, type MemberId, type NewEvent, type PaymentId, type Result, type StudioId } from '../../../shared'
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
): Result<Outcome<InvoiceMark>, DomainError> {
  if (payment.voided) return err({ code: 'operation_not_applicable' })
  if (current?.issued) return err({ code: 'operation_not_applicable' })
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
    },
    events: [
      {
        ...base(ctx, payment),
        type: INVOICE_ISSUED,
        payload: { amount: payment.amount, method: payment.method, receivedAt: payment.receivedAt },
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
    next: { ...current, issued: false, issuedAt: null, issuedBy: null },
    events: [{ ...base(ctx, payment), type: INVOICE_REVERTED, payload: { reason: reason.trim() } }],
  })
}
