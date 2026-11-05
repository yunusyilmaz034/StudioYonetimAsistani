import { err, money, ok, type ActorRef, type DomainError, type Instant, type MemberId, type Money, type NewEvent, type PaymentId, type Result, type StudioId } from '../../../shared'
import {
  INVOICE_E_ARCHIVE_FAILED,
  INVOICE_E_ARCHIVE_REQUESTED,
  INVOICE_ISSUED,
  INVOICE_ISSUED_VERSION,
  INVOICE_REVERTED,
  type EArchiveFailureCode,
  type InvoiceDocument,
  type InvoiceProvider,
} from '../events'
import type { DecideContext, Outcome } from './decide'
import type { InvoicePolicy } from './invoice-policy'
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
  /** FT-2. Which document. `null` on a mark ticked before FT-2 ("elle işaretli") or reverted. */
  readonly document: InvoiceDocument | null
  /** FT-2. `parasut` when the integration cut it; `null` when a human ticked it. */
  readonly provider: InvoiceProvider | null
  /** FT-2. The e-Arşiv number GİB gave it, e.g. "RTA2026000000118". */
  readonly documentNo: string | null
  /** FT-2. The in-flight e-Arşiv request. `null` when none is in flight or after it settled. */
  readonly eArchive: EArchiveRequest | null
  /** FT-2. Where the e-Arşiv PDF was asked to go (owner, 2026-11-05). PII — state only, never in an event. */
  readonly emailTo: string | null
}

export interface EArchiveRequest {
  readonly requestId: string
  readonly status: 'pending' | 'failed'
  readonly requestedAt: Instant
  readonly requestedBy: ActorRef
  readonly invoicedAmount: Money
  readonly attempt: number
  /** The provider's sentence, for the row. State only. */
  readonly error: string | null
  /** Send the PDF here once it is cut; null = do not send. PII — state only. */
  readonly emailTo: string | null
}

/** Loose on purpose: the provider is the real judge; this only refuses what cannot be an address. */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)

/**
 * A request nobody has heard back from in this long may be pressed again. Safe because the retry
 * carries the SAME `requestId`, and Paraşüt refuses a second invoice for one key.
 */
export const E_ARCHIVE_STALE_MS = 15 * 60_000

const base = (ctx: DecideContext, payment: Payment, version = 1): Omit<NewEvent, 'type' | 'payload'> => ({
  studioId: ctx.studioId,
  branchId: payment.branchId,
  version,
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

const empty = (payment: Payment): InvoiceMark => ({
  paymentId: payment.id,
  studioId: payment.studioId,
  memberId: payment.memberId,
  issued: false,
  issuedAt: null,
  issuedBy: null,
  note: null,
  invoicedAmount: null,
  document: null,
  provider: null,
  documentNo: null,
  eArchive: null,
  emailTo: null,
})

const inFlight = (m: InvoiceMark | null, now: number) =>
  m?.eArchive?.status === 'pending' && now - m.eArchive.requestedAt < E_ARCHIVE_STALE_MS

const validKurus = (k: number) => Number.isInteger(k) && k > 0

/**
 * Tick by hand: the desk cut the document somewhere else (an ÖKC receipt, or an e-Arşiv in the portal).
 * A voided payment has nothing to invoice; a request in flight must settle first, or the integration
 * and the hand would both cut one.
 */
export function decideIssueInvoice(
  ctx: DecideContext,
  payment: Payment,
  current: InvoiceMark | null,
  note: string | null,
  invoicedKurus: number,
  document: InvoiceDocument,
): Result<Outcome<InvoiceMark>, DomainError> {
  if (payment.voided) return err({ code: 'operation_not_applicable' })
  if (current?.issued) return err({ code: 'operation_not_applicable' })
  if (current?.eArchive?.status === 'pending') return err({ code: 'invoice_in_progress' })
  // Money is an integer of kuruş (#10); an invoice of nothing is not an invoice.
  if (!validKurus(invoicedKurus)) return err({ code: 'invalid_amount' })
  const invoicedAmount = money(invoicedKurus)
  const trimmed = note?.trim() ? note.trim() : null
  return ok({
    next: {
      ...(current ?? empty(payment)),
      issued: true,
      issuedAt: ctx.now,
      issuedBy: ctx.actor,
      note: trimmed,
      invoicedAmount,
      document,
      provider: null,
      documentNo: null,
      eArchive: null,
      emailTo: null,
    },
    events: [
      {
        ...base(ctx, payment, INVOICE_ISSUED_VERSION),
        type: INVOICE_ISSUED,
        payload: { amount: payment.amount, invoicedAmount, method: payment.method, receivedAt: payment.receivedAt, document, provider: null },
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
    next: { ...current, issued: false, issuedAt: null, issuedBy: null, invoicedAmount: null, document: null, provider: null, documentNo: null, eArchive: null, emailTo: null },
    events: [{ ...base(ctx, payment), type: INVOICE_REVERTED, payload: { reason: reason.trim() } }],
  })
}

// ── FT-2 · e-ARŞİV (OR-132) ─────────────────────────────────────────────────────────────────────
//
//   (none | failed | stale pending) ──request──▶ pending ──issued──▶ issued (e_archive, parasut)
//                                                   └────failed──▶ failed ──request (same id)──▶ …
//
// Always a human's press. The worker never requests; it only reports back on a request it was given.

/**
 * A human asks for an e-Arşiv. `requestId` is generated by the caller (a UUID — the decision stays
 * pure) and is used ONLY on the first request: every retry reuses the stored one, so whatever the
 * first attempt got as far as creating at Paraşüt is found again instead of created twice. For the
 * same reason the amount of a retry is the amount of the first request.
 */
export function decideRequestEArchive(
  ctx: DecideContext,
  payment: Payment,
  current: InvoiceMark | null,
  policy: InvoicePolicy,
  invoicedKurus: number,
  newRequestId: string,
  emailTo: string | null = null,
): Result<Outcome<InvoiceMark>, DomainError> {
  if (payment.voided) return err({ code: 'operation_not_applicable' })
  if (current?.issued) return err({ code: 'operation_not_applicable' })
  if (inFlight(current, ctx.now)) return err({ code: 'invoice_in_progress' })
  // Any method may get one: a card or cash customer who asks for an e-Arşiv gets it (OR-132).
  if (policy.vatRatePercent === null || policy.parasut.companyId === null) return err({ code: 'invoice_not_configured' })

  const to = emailTo?.trim() ? emailTo.trim() : null
  if (to !== null && !isEmail(to)) return err({ code: 'invalid_email' })
  const previous = current?.eArchive ?? null
  const kurus = previous ? previous.invoicedAmount.amount : invoicedKurus
  if (!validKurus(kurus)) return err({ code: 'invalid_amount' })
  const invoicedAmount = money(kurus)
  const requestId = previous?.requestId ?? newRequestId
  const attempt = (previous?.attempt ?? 0) + 1
  return ok({
    next: {
      ...(current ?? empty(payment)),
      eArchive: { requestId, status: 'pending', requestedAt: ctx.now, requestedBy: ctx.actor, invoicedAmount, attempt, error: null, emailTo: to },
    },
    events: [
      {
        ...base(ctx, payment),
        type: INVOICE_E_ARCHIVE_REQUESTED,
        payload: { requestId, amount: payment.amount, invoicedAmount, method: payment.method, receivedAt: payment.receivedAt, attempt },
      },
    ],
  })
}

/**
 * The worker reports: Paraşüt cut it. Accepted only for the request in flight — a late answer for a
 * request that has since been settled changes nothing. Stale pending is still accepted: being slow is
 * not being wrong, and the invoice exists either way.
 */
export function decideEArchiveIssued(
  ctx: DecideContext,
  payment: Payment,
  current: InvoiceMark | null,
  requestId: string,
  documentNo: string,
): Result<Outcome<InvoiceMark>, DomainError> {
  const req = current?.eArchive
  if (!current || current.issued || !req || req.requestId !== requestId) return err({ code: 'operation_not_applicable' })
  return ok({
    next: {
      ...current,
      issued: true,
      issuedAt: ctx.now,
      issuedBy: req.requestedBy,
      invoicedAmount: req.invoicedAmount,
      document: 'e_archive',
      provider: 'parasut',
      documentNo: documentNo.trim() || null,
      note: current.note,
      eArchive: null,
      emailTo: req.emailTo,
    },
    events: [
      {
        ...base(ctx, payment, INVOICE_ISSUED_VERSION),
        type: INVOICE_ISSUED,
        payload: {
          amount: payment.amount,
          invoicedAmount: req.invoicedAmount,
          method: payment.method,
          receivedAt: payment.receivedAt,
          document: 'e_archive',
          provider: 'parasut',
        },
      },
    ],
  })
}

/** The worker reports: it did not go through. The row says why and offers "Tekrar dene". */
export function decideEArchiveFailed(
  ctx: DecideContext,
  payment: Payment,
  current: InvoiceMark | null,
  requestId: string,
  code: EArchiveFailureCode,
  message: string,
): Result<Outcome<InvoiceMark>, DomainError> {
  const req = current?.eArchive
  if (!current || current.issued || !req || req.requestId !== requestId || req.status !== 'pending') return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, eArchive: { ...req, status: 'failed', error: message.trim().slice(0, 300) || null } },
    events: [{ ...base(ctx, payment), type: INVOICE_E_ARCHIVE_FAILED, payload: { requestId, code } }],
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
