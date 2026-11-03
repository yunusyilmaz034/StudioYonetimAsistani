import { describe, expect, it } from 'vitest'

import { instant, money, type BranchId, type CorrelationId, type MemberId, type StaffUserId, type StudioId } from '../../../shared'
import { decideIssueInvoice, decideRevertInvoice } from './invoice'
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
    const r = decideIssueInvoice(ctx, pay(), null, '  e-arşiv 118  ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next).toMatchObject({ issued: true, issuedAt: ctx.now, issuedBy: ctx.actor, note: 'e-arşiv 118', memberId: 'mem_1' })
  })

  it('a blank note is no note', () => {
    const r = decideIssueInvoice(ctx, pay(), null, '   ')
    expect(r.ok && r.value.next.note).toBe(null)
  })

  it('refuses a voided payment — there is nothing to invoice', () => {
    expect(decideIssueInvoice(ctx, pay({ voided: true }), null, null)).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })

  it('refuses a second tick — one invoice per payment', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null)
    if (!on.ok) throw new Error('setup')
    expect(decideIssueInvoice(ctx, pay(), on.value.next, null).ok).toBe(false)
  })

  it('may tick again after a reverted tick', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null)
    if (!on.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), on.value.next, 'yanlış')
    if (!off.ok) throw new Error('setup')
    expect(decideIssueInvoice(ctx, pay(), off.value.next, null).ok).toBe(true)
  })
})

describe('decideRevertInvoice', () => {
  it('refuses without a reason', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null)
    if (!on.ok) throw new Error('setup')
    expect(decideRevertInvoice(ctx, pay(), on.value.next, '  ')).toEqual({ ok: false, error: { code: 'reason_required' } })
  })

  it('refuses when nothing was ticked', () => {
    expect(decideRevertInvoice(ctx, pay(), null, 'x').ok).toBe(false)
  })

  it('clears the stamp and keeps the note', () => {
    const on = decideIssueInvoice(ctx, pay(), null, 'not')
    if (!on.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), on.value.next, 'yanlış')
    expect(off.ok && off.value.next).toMatchObject({ issued: false, issuedAt: null, issuedBy: null, note: 'not' })
  })
})
