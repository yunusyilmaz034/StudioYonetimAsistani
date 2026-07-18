import { describe, expect, it } from 'vitest'

import { instant, money, type ActorRef, type CorrelationId, type MemberId, type StudioId } from '../../../shared'
import {
  decideCancelCollection,
  decideCreatePaymentLink,
  decideDeactivatePaymentLink,
  decideReceiveCollection,
  decideReconcileCollection,
  type DecideContext,
} from './decide'
import type { PaymentLink, PaytrCollection } from './types'

const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'system', id: 'paytr_callback' } as ActorRef,
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'paytr_callback',
}

const link: PaymentLink = {
  id: 'plink_1',
  studioId: 'std_1' as StudioId,
  label: 'Fitness 3 Aylık',
  amount: money(900_000),
  maxInstallments: 3,
  active: true,
  createdBy: { type: 'owner', id: 'usr_1' } as ActorRef,
  createdAt: instant(1_699_000_000_000),
}

const collection: PaytrCollection = {
  id: 'pcol_1',
  studioId: 'std_1' as StudioId,
  linkId: 'plink_1',
  amount: money(900_000),
  installments: 3,
  buyerName: 'Ayşe Öz',
  buyerPhone: '+905551112233',
  providerRef: 'ref123',
  paidAt: instant(1_700_000_000_000),
  status: 'unreconciled',
  memberId: null,
  paymentId: null,
  reconciledBy: null,
  reconciledAt: null,
}

describe('PF-37 — payment links + PAYTR collections', () => {
  it('a created link carries amount + installments, no PII', () => {
    const e = decideCreatePaymentLink(ctx, link)[0]
    expect(e?.payload).toEqual({ linkId: 'plink_1', amount: money(900_000), maxInstallments: 3 })
  })

  it('deactivating an already-inactive link is a no-op (idempotent)', () => {
    expect(decideDeactivatePaymentLink(ctx, { ...link, active: false }).events).toHaveLength(0)
    expect(decideDeactivatePaymentLink(ctx, link).events).toHaveLength(1)
  })

  it('a received collection NEVER carries the buyer name/phone in the event (#6)', () => {
    const e = decideReceiveCollection(ctx, collection)[0]
    expect(e?.payload).toEqual({ collectionId: 'pcol_1', linkId: 'plink_1', amount: money(900_000), installments: 3 })
    const json = JSON.stringify(e?.payload)
    expect(json).not.toContain('Ayşe')
    expect(json).not.toContain('905551112233')
  })

  it('reconcile attributes the collection to a member + ledger payment', () => {
    const r = decideReconcileCollection(ctx, collection, 'mem_9' as MemberId, 'pay_9')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next).toMatchObject({ status: 'reconciled', memberId: 'mem_9', paymentId: 'pay_9' })
    expect(r.value.events[0]?.payload).toEqual({ collectionId: 'pcol_1', memberId: 'mem_9', paymentId: 'pay_9' })
  })

  it('refuses to reconcile or cancel a collection that is not unreconciled', () => {
    const done: PaytrCollection = { ...collection, status: 'reconciled' }
    expect(decideReconcileCollection(ctx, done, 'mem_9' as MemberId, 'pay_9').ok).toBe(false)
    expect(decideCancelCollection(ctx, done, 'yanlış').ok).toBe(false)
  })

  it('cancel demands a reason', () => {
    expect(decideCancelCollection(ctx, collection, '  ').ok).toBe(false)
    const r = decideCancelCollection(ctx, collection, 'test ödemesi')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.status).toBe('cancelled')
  })
})
