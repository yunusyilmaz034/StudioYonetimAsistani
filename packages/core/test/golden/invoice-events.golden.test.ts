import { describe, expect, it } from 'vitest'

import { decideIssueInvoice, decideRevertInvoice } from '../../src/modules/finance/domain/invoice'
import type { Payment } from '../../src/modules/finance/domain/types'
import { instant, money, type BranchId, type CorrelationId, type MemberId, type StaffUserId, type StudioId } from '../../src/shared'
import issued from './invoice.issued.v1.json'
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
    const r = decideIssueInvoice(ctx, payment, null, 'e-arşiv GIB2026000000118', 200_000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('invoice.issued')
    expect(r.value.events[0]?.payload).toEqual(issued)
    expect(JSON.stringify(r.value.events[0])).not.toContain('GIB2026')
  })

  it('invoice.reverted matches the golden payload', () => {
    const on = decideIssueInvoice(ctx, payment, null, null, 420_000)
    if (!on.ok) throw new Error('setup')
    const r = decideRevertInvoice(ctx, payment, on.value.next, 'yanlış satıra tiklendi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('invoice.reverted')
    expect(r.value.events[0]?.payload).toEqual(reverted)
  })
})
