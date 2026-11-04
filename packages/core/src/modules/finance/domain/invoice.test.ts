import { describe, expect, it } from 'vitest'

import { instant, money, type BranchId, type CorrelationId, type MemberId, type StaffUserId, type StudioId } from '../../../shared'
import {
  decideEArchiveFailed,
  decideEArchiveIssued,
  decideIssueInvoice,
  decideRequestEArchive,
  decideRevertInvoice,
  E_ARCHIVE_STALE_MS,
  invoicesDue,
  type InvoiceMark,
} from './invoice'
import { DEFAULT_INVOICE_POLICY, documentRuleFor, netUnitPrice, parseInvoicePolicy, serviceLineFor } from './invoice-policy'
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
    const r = decideIssueInvoice(ctx, pay(), null, '  e-arşiv 118  ', 320_000, 'okc_receipt')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next).toMatchObject({ issued: true, issuedAt: ctx.now, issuedBy: ctx.actor, note: 'e-arşiv 118', memberId: 'mem_1' })
  })

  it('a blank note is no note', () => {
    const r = decideIssueInvoice(ctx, pay(), null, '   ', 320_000, 'okc_receipt')
    expect(r.ok && r.value.next.note).toBe(null)
  })

  it('refuses a voided payment — there is nothing to invoice', () => {
    expect(decideIssueInvoice(ctx, pay({ voided: true }), null, null, 320_000, 'okc_receipt')).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })

  it('refuses a second tick — one invoice per payment', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 320_000, 'okc_receipt')
    if (!on.ok) throw new Error('setup')
    expect(decideIssueInvoice(ctx, pay(), on.value.next, null, 320_000, 'okc_receipt').ok).toBe(false)
  })

  it('may tick again after a reverted tick', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 320_000, 'okc_receipt')
    if (!on.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), on.value.next, 'yanlış')
    if (!off.ok) throw new Error('setup')
    expect(decideIssueInvoice(ctx, pay(), off.value.next, null, 320_000, 'okc_receipt').ok).toBe(true)
  })
})

describe('decideRevertInvoice', () => {
  it('refuses without a reason', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 320_000, 'okc_receipt')
    if (!on.ok) throw new Error('setup')
    expect(decideRevertInvoice(ctx, pay(), on.value.next, '  ')).toEqual({ ok: false, error: { code: 'reason_required' } })
  })

  it('refuses when nothing was ticked', () => {
    expect(decideRevertInvoice(ctx, pay(), null, 'x').ok).toBe(false)
  })

  it('clears the stamp and keeps the note', () => {
    const on = decideIssueInvoice(ctx, pay(), null, 'not', 320_000, 'okc_receipt')
    if (!on.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), on.value.next, 'yanlış')
    expect(off.ok && off.value.next).toMatchObject({ issued: false, issuedAt: null, issuedBy: null, note: 'not' })
  })
})

describe('invoiced amount — recorded as typed, not judged (owner, 2026-11-03)', () => {
  it('may differ from the payment', () => {
    const r = decideIssueInvoice(ctx, pay(), null, null, 100_000, 'okc_receipt')
    expect(r.ok && r.value.next.invoicedAmount).toEqual(money(100_000))
  })
  it.each([0, -5, 12.5])('refuses %s', (k) => {
    expect(decideIssueInvoice(ctx, pay(), null, null, k, 'okc_receipt')).toEqual({ ok: false, error: { code: 'invalid_amount' } })
  })
  it('a revert clears it', () => {
    const on = decideIssueInvoice(ctx, pay(), null, null, 100_000, 'okc_receipt')
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

// ── FT-2 · e-Arşiv (OR-132) ─────────────────────────────────────────────────────────────────────
const policy = { ...DEFAULT_INVOICE_POLICY, vatRatePercent: 20, parasut: { ...DEFAULT_INVOICE_POLICY.parasut, companyId: '115' } }
const at = (ms: number) => ({ ...ctx, now: instant(ms) })
const system = { ...ctx, actor: { type: 'system' as const, id: 'e_archive' } } as unknown as typeof ctx
const KEY = '0b8f4a1e-3c55-4c1e-9a62-2f8d7c9e5a10'
function requested(over: Partial<Payment> = {}): InvoiceMark {
  const r = decideRequestEArchive(ctx, pay(over), null, policy, 320_000, KEY)
  if (!r.ok) throw new Error('setup')
  return r.value.next
}

describe('decideRequestEArchive', () => {
  it('puts the request in flight with the caller\'s key, attempt 1', () => {
    expect(requested().eArchive).toMatchObject({ requestId: KEY, status: 'pending', attempt: 1, invoicedAmount: money(320_000), requestedBy: ctx.actor })
  })

  it('refuses until the accountant\'s VAT rate is set — the system never guesses a tax', () => {
    const r = decideRequestEArchive(ctx, pay(), null, { ...policy, vatRatePercent: null }, 320_000, KEY)
    expect(r).toEqual({ ok: false, error: { code: 'invoice_not_configured' } })
  })

  it('refuses until Paraşüt is connected', () => {
    const r = decideRequestEArchive(ctx, pay(), null, { ...policy, parasut: { ...policy.parasut, companyId: null } }, 320_000, KEY)
    expect(r).toEqual({ ok: false, error: { code: 'invoice_not_configured' } })
  })

  it('refuses a second press while one is in flight — two requests would be two invoices', () => {
    expect(decideRequestEArchive(at(ctx.now + 60_000), pay(), requested(), policy, 320_000, 'other')).toEqual({ ok: false, error: { code: 'invoice_in_progress' } })
  })

  it('a stale request may be pressed again — with the SAME key, so Paraşüt finds what it already made', () => {
    const r = decideRequestEArchive(at(ctx.now + E_ARCHIVE_STALE_MS), pay(), requested(), policy, 999_00, 'other')
    expect(r.ok && r.value.next.eArchive).toMatchObject({ requestId: KEY, attempt: 2, invoicedAmount: money(320_000) })
  })

  it('one minute short of stale is still in flight', () => {
    expect(decideRequestEArchive(at(ctx.now + E_ARCHIVE_STALE_MS - 1), pay(), requested(), policy, 320_000, 'x').ok).toBe(false)
  })

  it('a retry after a failure keeps the key and the first amount', () => {
    const f = decideEArchiveFailed(system, pay(), requested(), KEY, 'rejected', 'adres eksik')
    if (!f.ok) throw new Error('setup')
    const r = decideRequestEArchive(ctx, pay(), f.value.next, policy, 1, 'new')
    expect(r.ok && r.value.next.eArchive).toMatchObject({ requestId: KEY, status: 'pending', attempt: 2, invoicedAmount: money(320_000), error: null })
  })

  it('refuses an issued payment and a voided one', () => {
    const t = decideIssueInvoice(ctx, pay(), null, null, 320_000, 'okc_receipt')
    if (!t.ok) throw new Error('setup')
    expect(decideRequestEArchive(ctx, pay(), t.value.next, policy, 320_000, KEY).ok).toBe(false)
    expect(decideRequestEArchive(ctx, pay({ voided: true }), null, policy, 320_000, KEY).ok).toBe(false)
  })

  it('any method may get one — a card customer who asks gets an e-Arşiv too', () => {
    expect(decideRequestEArchive(ctx, pay({ method: 'credit_card' }), null, policy, 320_000, KEY).ok).toBe(true)
  })

  it.each([0, -1, 10.5])('refuses amount %s', (k) => {
    expect(decideRequestEArchive(ctx, pay(), null, policy, k, KEY)).toEqual({ ok: false, error: { code: 'invalid_amount' } })
  })
})

describe('hand tick vs e-Arşiv — one payment, one document', () => {
  it('a hand tick is refused while an e-Arşiv is in flight', () => {
    expect(decideIssueInvoice(ctx, pay(), requested(), null, 320_000, 'okc_receipt')).toEqual({ ok: false, error: { code: 'invoice_in_progress' } })
  })
  it('after a failure the desk may tick a receipt instead; the request is closed', () => {
    const f = decideEArchiveFailed(system, pay(), requested(), KEY, 'rejected', 'x')
    if (!f.ok) throw new Error('setup')
    const t = decideIssueInvoice(ctx, pay(), f.value.next, null, 320_000, 'okc_receipt')
    expect(t.ok && t.value.next).toMatchObject({ issued: true, document: 'okc_receipt', provider: null, eArchive: null })
  })
})

describe('decideEArchiveIssued / decideEArchiveFailed', () => {
  it('issued: the tick comes from the integration, credited to the human who pressed', () => {
    const r = decideEArchiveIssued(system, pay(), requested(), KEY, ' RTA2026000000118 ')
    expect(r.ok && r.value.next).toMatchObject({ issued: true, document: 'e_archive', provider: 'parasut', documentNo: 'RTA2026000000118', issuedBy: ctx.actor, invoicedAmount: money(320_000), eArchive: null })
    expect(r.ok && r.value.events[0]).toMatchObject({ type: 'invoice.issued', version: 2, actor: system.actor, payload: { document: 'e_archive', provider: 'parasut' } })
  })
  it('ignores an answer for another request', () => {
    expect(decideEArchiveIssued(system, pay(), requested(), 'other', 'X').ok).toBe(false)
    expect(decideEArchiveFailed(system, pay(), requested(), 'other', 'rejected', 'x').ok).toBe(false)
  })
  it('a failure after it was already issued changes nothing', () => {
    const i = decideEArchiveIssued(system, pay(), requested(), KEY, 'X')
    if (!i.ok) throw new Error('setup')
    expect(decideEArchiveFailed(system, pay(), i.value.next, KEY, 'rejected', 'x').ok).toBe(false)
  })
  it('a late success after a failure is still accepted — the invoice exists either way', () => {
    const f = decideEArchiveFailed(system, pay(), requested(), KEY, 'provider_error', 'zaman aşımı')
    if (!f.ok) throw new Error('setup')
    expect(decideEArchiveIssued(system, pay(), f.value.next, KEY, 'X').ok).toBe(true)
  })
  it('failed keeps the provider sentence on state, trimmed to 300', () => {
    const r = decideEArchiveFailed(system, pay(), requested(), KEY, 'rejected', 'x'.repeat(400))
    expect(r.ok && r.value.next.eArchive?.error?.length).toBe(300)
  })
  it('a revert clears the e-Arşiv stamp', () => {
    const i = decideEArchiveIssued(system, pay(), requested(), KEY, 'X')
    if (!i.ok) throw new Error('setup')
    const off = decideRevertInvoice(ctx, pay(), i.value.next, 'Paraşüt’te iptal edildi')
    expect(off.ok && off.value.next).toMatchObject({ issued: false, document: null, provider: null, documentNo: null })
  })
})

describe('invoice policy (OR-132)', () => {
  it('defaults: card/POS automatic ÖKC, cash ÖKC by hand, transfer and online e-Arşiv', () => {
    const p = DEFAULT_INVOICE_POLICY
    expect([documentRuleFor(p, 'credit_card'), documentRuleFor(p, 'pos'), documentRuleFor(p, 'cash'), documentRuleFor(p, 'bank_transfer'), documentRuleFor(p, 'online')]).toEqual([
      'okc_auto', 'okc_auto', 'okc_manual', 'e_archive', 'e_archive',
    ])
    expect(p.vatRatePercent).toBe(null)
  })
  it('parse keeps valid values and falls back on junk', () => {
    const p = parseInvoicePolicy({ documentByMethod: { cash: 'e_archive', pos: 'nonsense' }, vatRatePercent: 10.5, receiptLimitKurus: 990_000, parasut: { environment: 'production', companyId: ' 115 ' } })
    expect(p.documentByMethod.cash).toBe('e_archive')
    expect(p.documentByMethod.pos).toBe('okc_auto')
    expect(p.vatRatePercent).toBe(null)
    expect(p.receiptLimitKurus).toBe(990_000)
    expect(p.parasut).toMatchObject({ environment: 'production', companyId: '115' })
    expect(parseInvoicePolicy(undefined)).toEqual(DEFAULT_INVOICE_POLICY)
  })
  it('service line fills the package names, or drops the slot', () => {
    expect(serviceLineFor(DEFAULT_INVOICE_POLICY, ['8 ders reformer', '8 ders reformer'])).toBe('Pilates hizmeti — 8 ders reformer')
    expect(serviceLineFor(DEFAULT_INVOICE_POLICY, [])).toBe('Pilates hizmeti')
  })
  it('net unit price round-trips to the gross for every lira amount to 20.000 TL at 10% and 20%', () => {
    for (const vat of [10, 20]) {
      for (let k = 100; k <= 2_000_000; k += 100) {
        const net = netUnitPrice(k, vat)
        const gross = Math.round((net + (net * vat) / 100) * 100)
        expect(gross).toBe(k)
      }
    }
  })
})
