import { describe, expect, it } from 'vitest'

import { instant, money, type BranchId, type CorrelationId, type MemberId, type StaffUserId, type StudioId } from '../../../shared'
import { decideIssueInvoice, decideRevertInvoice, invoicesDue } from './invoice'
import type { Payment } from './types'

// FATURA TAKİBİ (owner, 2026-11-03): tick = "faturası kesildi", un-tick = a correction with a reason.
const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_owner' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
}
const pay = (over: Partial<Payment> = {}): Payment =>
  ({
    id: 'pay_1',
    studioId: 'std_1' as StudioId,
    branchId: 'br_1' as BranchId,
    memberId: 'mem_1' as MemberId,
    amount: money(320_000),
    method: 'bank_transfer',
    receivedAt: instant(1_699_000_000_000),
    takenBy: { type: 'receptionist', id: 'usr_desk' },
    drawerId: null,
    providerRef: null,
    giftCardId: null,
    allocated: money(320_000),
    voided: false,
    voidReason: null,
    note: null,
    ...over,
  }) as Payment

describe('decideIssueInvoice', () => {
  it('ticks a live payment, stamping who and when, keeping a trimmed note', () => {
    const r = decideIssueInvoice(ctx, pay(), null, '  e-arşiv 118  ', 320_000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next).toMatchObject({ issued: true, issuedAt: ctx.now, issuedBy: ctx.actor, note: 'e-arşiv 118', memberId: 'mem_1' })
  })

  it('a blank note is no note', () => {
    const r = decideIssueInvoice(ctx, pay(), null, '   ', 320_000)
    expect(r.ok && r.value.next.note).toBe(null)
  })

  it('refuses a voided payment — there is nothing to invoice', () => {
    expect(decideIssueInvoice(ctx, pay({ voided: true }), null, null, 320_000)).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })

  it('refuses a second tick — one invoice per payment', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 320_000)
    if (!on.ok) throw new Error('setup')
    expect(decideIssueInvoice(ctx, pay(), on.value.next, null, 320_000).ok).toBe(false)
  })

  it('may tick again after a reverted tick', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 320_000)
    if (!on.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), on.value.next, 'yanlış')
    if (!off.ok) throw new Error('setup')
    expect(decideIssueInvoice(ctx, pay(), off.value.next, null, 320_000).ok).toBe(true)
  })
})

describe('decideRevertInvoice', () => {
  it('refuses without a reason', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 320_000)
    if (!on.ok) throw new Error('setup')
    expect(decideRevertInvoice(ctx, pay(), on.value.next, '  ')).toEqual({ ok: false, error: { code: 'reason_required' } })
  })

  it('refuses when nothing was ticked', () => {
    expect(decideRevertInvoice(ctx, pay(), null, 'x').ok).toBe(false)
  })

  it('clears the stamp and keeps the note', () => {
    const on = decideIssueInvoice(ctx, pay(), null, 'not', 320_000)
    if (!on.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), on.value.next, 'yanlış')
    expect(off.ok && off.value.next).toMatchObject({ issued: false, issuedAt: null, issuedBy: null, note: 'not' })
  })
})

describe('invoiced amount — recorded as typed, not judged (owner, 2026-11-03)', () => {
  it('may differ from the payment', () => {
    const r = decideIssueInvoice(ctx, pay(), null, null, 100_000)
    expect(r.ok && r.value.next.invoicedAmount).toEqual(money(100_000))
  })
  it.each([0, -5, 12.5])('refuses %s', (k) => {
    expect(decideIssueInvoice(ctx, pay(), null, null, k)).toEqual({ ok: false, error: { code: 'invalid_amount' } })
  })
  it('a revert clears it', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 100_000)
    if (!on.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), on.value.next, 'yanlış')
    expect(off.ok && off.value.next.invoicedAmount).toBe(null)
  })
})

describe('invoicesDue — havale/EFT, 7 days', () => {
  const DAY = 86_400_000
  const NOW = 1_700_000_000_000
  const at = (daysAgo: number, over: Partial<Payment> = {}) => pay({ id: `p${daysAgo}`, receivedAt: instant(NOW - daysAgo * DAY), ...over })

  it('warns from the 4th day on; days 0–3 are quiet', () => {
    const r = invoicesDue([at(1), at(3), at(4), at(6)], new Set(), new Set(), NOW)
    expect(r.map((d) => [d.paymentId, d.daysLeft])).toEqual([['p6', 1], ['p4', 3]])
  })
  it('keeps reporting an overdue one, most urgent first, up to 30 days back', () => {
    const r = invoicesDue([at(5), at(9), at(31)], new Set(), new Set(), NOW)
    expect(r.map((d) => [d.paymentId, d.daysLeft])).toEqual([['p9', -2], ['p5', 2]])
  })
  it('the 7th day is the last day (0 left)', () => {
    expect(invoicesDue([at(7)], new Set(), new Set(), NOW)[0]?.daysLeft).toBe(0)
  })
  it('ticked, voided, test-account and non-transfer payments are not on it', () => {
    const r = invoicesDue(
      [at(5, { id: 'done' }), at(5, { id: 'void', voided: true }), at(5, { id: 'test', memberId: 'mem_test' as MemberId }), at(5, { id: 'cash', method: 'cash' })],
      new Set(['done']),
      new Set(['mem_test']),
      NOW,
    )
    expect(r).toEqual([])
  })
})
