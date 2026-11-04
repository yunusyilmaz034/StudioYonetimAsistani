import { describe, expect, it } from 'vitest'

import { upcastInvoiceIssued } from '../../src/modules/finance/events'
import { decideEArchiveFailed, decideIssueInvoice, decideRequestEArchive, decideRevertInvoice } from '../../src/modules/finance/domain/invoice'
import { DEFAULT_INVOICE_POLICY } from '../../src/modules/finance/domain/invoice-policy'
import type { Payment } from '../../src/modules/finance/domain/types'
import { instant, money, type BranchId, type CorrelationId, type MemberId, type StaffUserId, type StudioId } from '../../src/shared'
import issuedV1 from './invoice.issued.v1.json'
import issued from './invoice.issued.v2.json'
import requested from './invoice.e_archive_requested.v1.json'
import failed from './invoice.e_archive_failed.v1.json'
import reverted from './invoice.reverted.v1.json'

// `invoice.issued` / `invoice.reverted` (owner, 2026-11-03) — NEW event types, nothing existing is
// touched. The note the desk writes and the member's TC kimlik stay on state; the log holds only the
// money facts the tick was about.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_owner' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
}

const payment = {
  id: 'pay_1',
  studioId: 'std_1' as StudioId,
  branchId: 'br_1' as BranchId,
  memberId: 'mem_1' as MemberId,
  amount: money(420_000),
  method: 'cash',
  receivedAt: instant(1_699_990_000_000),
  takenBy: { type: 'receptionist', id: 'usr_desk' },
  drawerId: 'drw_1',
  providerRef: null,
  giftCardId: null,
  allocated: money(420_000),
  voided: false,
  voidReason: null,
  note: null,
} as Payment

describe('invoice events', () => {
  it('invoice.issued matches the golden payload, and the note never reaches it', () => {
    const r = decideIssueInvoice(ctx, payment, null, 'e-arşiv GIB2026000000118', 200_000, 'okc_receipt')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('invoice.issued')
    expect(r.value.events[0]?.version).toBe(2)
    expect(r.value.events[0]?.payload).toEqual(issued)
    expect(JSON.stringify(r.value.events[0])).not.toContain('GIB2026')
  })

  it('invoice.reverted matches the golden payload', () => {
    const on = decideIssueInvoice(ctx, payment, null, null, 420_000, 'okc_receipt')
    if (!on.ok) throw new Error('setup')
    const r = decideRevertInvoice(ctx, payment, on.value.next, 'yanlış satıra tiklendi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('invoice.reverted')
    expect(r.value.events[0]?.payload).toEqual(reverted)
  })

  // FT-2 (owner-approved schema change, 2026-11-04): v1 never said which document was cut.
  it('invoice.issued v1 upcasts to v2 with document and provider "not recorded"', () => {
    expect(upcastInvoiceIssued(issuedV1, 1)).toEqual({ ...issuedV1, document: null, provider: null })
    expect(upcastInvoiceIssued(issued, 2)).toEqual(issued)
  })

  const policy = { ...DEFAULT_INVOICE_POLICY, vatRatePercent: 20, parasut: { ...DEFAULT_INVOICE_POLICY.parasut, companyId: '115' } }

  it('invoice.e_archive_requested matches the golden payload', () => {
    const r = decideRequestEArchive(ctx, payment, null, policy, 420_000, requested.requestId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('invoice.e_archive_requested')
    expect(r.value.events[0]?.payload).toEqual(requested)
  })

  it('invoice.e_archive_failed matches the golden payload, and the provider sentence never reaches it', () => {
    const on = decideRequestEArchive(ctx, payment, null, policy, 420_000, requested.requestId)
    if (!on.ok) throw new Error('setup')
    const r = decideEArchiveFailed(ctx, payment, on.value.next, requested.requestId, 'rejected', 'Alıcı Ayşe Yılmaz adresi eksik')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual(failed)
    expect(JSON.stringify(r.value.events[0])).not.toContain('Ayşe')
  })
})
