'use server'

import {
  createPaymentLink,
  deactivatePaymentLink,
  FirestorePaymentLinkRepository,
  FirestorePaytrCollectionRepository,
  money,
  systemClock,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// PF-37 — the settings-side link generator. The owner creates a shareable PAYTR payment link (a fixed
// amount + installment cap + label); the public `/pay/[linkId]` page turns it into a real PAYTR
// checkout. Creating/retiring a link is owner-only; reception may read the list to share one.
const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const deps = () => ({
  linkRepo: new FirestorePaymentLinkRepository(adminDb()),
  collectionRepo: new FirestorePaytrCollectionRepository(adminDb()),
  clock: systemClock,
})

export interface PaymentLinkRow {
  readonly id: string
  readonly label: string
  readonly amountKurus: number
  readonly maxInstallments: number
  readonly createdAt: number
}

export async function listPaymentLinksAction(): Promise<readonly PaymentLinkRow[]> {
  const ctx = await requireTenantContext(OPS)
  const links = await new FirestorePaymentLinkRepository(adminDb()).listActive(ctx)
  return links.map((l) => ({
    id: l.id,
    label: l.label,
    amountKurus: l.amount.amount,
    maxInstallments: l.maxInstallments,
    createdAt: l.createdAt,
  }))
}

export async function createPaymentLinkAction(input: unknown) {
  const p = z
    .object({
      label: z.string().min(1).max(120),
      amountKurus: z.number().int().positive(),
      maxInstallments: z.number().int().min(1).max(12),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  return createPaymentLink(deps(), ctx, {
    label: p.label,
    amount: money(p.amountKurus),
    maxInstallments: p.maxInstallments,
  })
}

export async function deactivatePaymentLinkAction(input: unknown) {
  const p = z.object({ linkId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  return deactivatePaymentLink(deps(), ctx, p.linkId)
}
