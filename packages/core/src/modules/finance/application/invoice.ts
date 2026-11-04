import { newOperationId, type DomainError, type Result, type TenantContext } from '../../../shared'
import type { EArchiveFailureCode, InvoiceDocument } from '../events'
import type { Outcome } from '../domain/decide'
import {
  decideEArchiveFailed,
  decideEArchiveIssued,
  decideIssueInvoice,
  decideRequestEArchive,
  decideRevertInvoice,
  type InvoiceMark,
} from '../domain/invoice'
import type { InvoicePolicy } from '../domain/invoice-policy'
import type { Payment } from '../domain/types'
import { dctx } from './finance'
import type { FinanceDeps } from './ports'

export interface InvoiceRepository {
  getInvoiceMark(ctx: TenantContext, paymentId: string): Promise<InvoiceMark | null>
  /** Batched read for the list screen — one document per payment that has ever been ticked. */
  listInvoiceMarks(ctx: TenantContext, paymentIds: readonly string[]): Promise<readonly InvoiceMark[]>
  /** Marks with an e-Arşiv request in flight — the worker's sweep. Small: a handful at a time. */
  listPendingEArchives(ctx: TenantContext): Promise<readonly InvoiceMark[]>
  /**
   * Read the mark, decide, write mark + events — in ONE transaction, so two presses of "e-Arşiv kes"
   * at the same moment cannot both pass the "nothing in flight" check (two requests = two invoices).
   */
  mutateInvoiceMark(
    ctx: TenantContext,
    paymentId: string,
    decide: (current: InvoiceMark | null) => Result<Outcome<InvoiceMark>, DomainError>,
  ): Promise<Result<InvoiceMark, DomainError>>
  getInvoicePolicy(ctx: TenantContext): Promise<InvoicePolicy>
  saveInvoicePolicy(ctx: TenantContext, policy: InvoicePolicy): Promise<void>
}

export interface InvoiceDeps extends FinanceDeps {
  readonly invoices: InvoiceRepository
}

const NOT_FOUND: Result<never, DomainError> = { ok: false, error: { code: 'operation_not_applicable' } }

async function withPayment(
  deps: InvoiceDeps,
  ctx: TenantContext,
  paymentId: string,
  decide: (payment: Payment, current: InvoiceMark | null) => Result<Outcome<InvoiceMark>, DomainError>,
): Promise<Result<InvoiceMark, DomainError>> {
  const payment = await deps.repo.getPayment(ctx, paymentId)
  if (!payment) return NOT_FOUND
  return deps.invoices.mutateInvoiceMark(ctx, paymentId, (current) => decide(payment, current))
}

const unit = (r: Result<unknown, DomainError>): Result<void, DomainError> => (r.ok ? { ok: true, value: undefined } : r)

export async function markInvoiceIssued(
  deps: InvoiceDeps,
  ctx: TenantContext,
  input: { paymentId: string; note: string | null; invoicedKurus: number; document: InvoiceDocument },
): Promise<Result<void, DomainError>> {
  const d = dctx(deps, ctx, newOperationId())
  return unit(await withPayment(deps, ctx, input.paymentId, (p, cur) => decideIssueInvoice(d, p, cur, input.note, input.invoicedKurus, input.document)))
}

export async function revertInvoice(
  deps: InvoiceDeps,
  ctx: TenantContext,
  input: { paymentId: string; reason: string },
): Promise<Result<void, DomainError>> {
  const d = dctx(deps, ctx, newOperationId())
  return unit(await withPayment(deps, ctx, input.paymentId, (p, cur) => decideRevertInvoice(d, p, cur, input.reason)))
}

/** FT-2 — a human pressed "e-Arşiv kes" (or "Tekrar dene"). The worker picks it up from the event. */
export async function requestEArchive(
  deps: InvoiceDeps,
  ctx: TenantContext,
  input: { paymentId: string; invoicedKurus: number; newRequestId: string },
): Promise<Result<void, DomainError>> {
  const policy = await deps.invoices.getInvoicePolicy(ctx)
  const d = dctx(deps, ctx, newOperationId())
  return unit(
    await withPayment(deps, ctx, input.paymentId, (p, cur) => decideRequestEArchive(d, p, cur, policy, input.invoicedKurus, input.newRequestId)),
  )
}

/** FT-2 worker → the invoice exists at GİB. Actor: the system principal the worker runs as (#5). */
export async function completeEArchive(
  deps: InvoiceDeps,
  ctx: TenantContext,
  input: { paymentId: string; requestId: string; documentNo: string },
): Promise<Result<void, DomainError>> {
  const d = dctx(deps, ctx, newOperationId())
  return unit(await withPayment(deps, ctx, input.paymentId, (p, cur) => decideEArchiveIssued(d, p, cur, input.requestId, input.documentNo)))
}

export async function failEArchive(
  deps: InvoiceDeps,
  ctx: TenantContext,
  input: { paymentId: string; requestId: string; code: EArchiveFailureCode; message: string },
): Promise<Result<void, DomainError>> {
  const d = dctx(deps, ctx, newOperationId())
  return unit(
    await withPayment(deps, ctx, input.paymentId, (p, cur) => decideEArchiveFailed(d, p, cur, input.requestId, input.code, input.message)),
  )
}

