import { newOperationId, type DomainError, type NewEvent, type Result, type TenantContext } from '../../../shared'
import { decideIssueInvoice, decideRevertInvoice, type InvoiceMark } from '../domain/invoice'
import { dctx } from './finance'
import type { FinanceDeps } from './ports'

export interface InvoiceRepository {
  getInvoiceMark(ctx: TenantContext, paymentId: string): Promise<InvoiceMark | null>
  /** Batched read for the list screen — one document per payment that has ever been ticked. */
  listInvoiceMarks(ctx: TenantContext, paymentIds: readonly string[]): Promise<readonly InvoiceMark[]>
  saveInvoiceMark(ctx: TenantContext, mark: InvoiceMark, events: readonly NewEvent[]): Promise<void>
}

export interface InvoiceDeps extends FinanceDeps {
  readonly invoices: InvoiceRepository
}

export async function markInvoiceIssued(
  deps: InvoiceDeps,
  ctx: TenantContext,
  input: { paymentId: string; note: string | null; invoicedKurus: number },
): Promise<Result<void, DomainError>> {
  const payment = await deps.repo.getPayment(ctx, input.paymentId)
  if (!payment) return { ok: false, error: { code: 'operation_not_applicable' } }
  const current = await deps.invoices.getInvoiceMark(ctx, input.paymentId)
  const r = decideIssueInvoice(dctx(deps, ctx, newOperationId()), payment, current, input.note, input.invoicedKurus)
  if (!r.ok) return r
  await deps.invoices.saveInvoiceMark(ctx, r.value.next, r.value.events)
  return { ok: true, value: undefined }
}

export async function revertInvoice(
  deps: InvoiceDeps,
  ctx: TenantContext,
  input: { paymentId: string; reason: string },
): Promise<Result<void, DomainError>> {
  const payment = await deps.repo.getPayment(ctx, input.paymentId)
  if (!payment) return { ok: false, error: { code: 'operation_not_applicable' } }
  const current = await deps.invoices.getInvoiceMark(ctx, input.paymentId)
  const r = decideRevertInvoice(dctx(deps, ctx, newOperationId()), payment, current, input.reason)
  if (!r.ok) return r
  await deps.invoices.saveInvoiceMark(ctx, r.value.next, r.value.events)
  return { ok: true, value: undefined }
}
