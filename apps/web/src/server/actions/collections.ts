'use server'

import {
  cancelCollection,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  FirestorePaymentLinkRepository,
  FirestorePaytrCollectionRepository,
  instant,
  money,
  normalizePhone,
  reconcileCollection,
  sellPackage,
  systemClock,
  type Grant,
  type MemberId,
  type ProductId,
  type SellPackageDeps,
  type TenantContext,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// PF-37 — the reconciliation side. An unattributed PAYTR collection sits in the kasa until reception
// attributes it to a member (existing or new) by selling the package with the collection's card
// payment. The money enters the ledger exactly once, attributed, carrying the PAYTR ref.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const OFFSET_MIN = 180

const paytrDeps = () => ({
  linkRepo: new FirestorePaymentLinkRepository(adminDb()),
  collectionRepo: new FirestorePaytrCollectionRepository(adminDb()),
  clock: systemClock,
})
const sellDeps = (): SellPackageDeps => ({
  finance: { repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock },
  entitlements: { repo: new FirestoreEntitlementRepository(adminDb()), clock: systemClock },
})
function dayMs(localDate: string): number {
  if (!localDate) return systemClock.now()
  const [y, m, d] = localDate.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - OFFSET_MIN * 60_000
}

// The member whose phone matches the buyer's — reception's "şu üye olabilir" suggestion.
async function matchMember(ctx: TenantContext, phoneE164: string): Promise<{ id: string; name: string } | null> {
  const n = normalizePhone(phoneE164)
  if (!n.ok) return null
  const uniq = await adminDb().doc(`studios/${ctx.studioId}/members_by_phone/${n.value.normalized}`).get()
  const memberId = uniq.data()?.memberId as string | undefined
  if (!memberId) return null
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId as MemberId)
  return member ? { id: memberId, name: member.fullName } : null
}

export interface UnreconciledCollectionRow {
  readonly id: string
  readonly amountKurus: number
  readonly installments: number
  readonly buyerName: string
  readonly buyerPhone: string
  readonly paidAt: number
  readonly suggestedMember: { readonly id: string; readonly name: string } | null
}

export async function listUnreconciledCollectionsAction(): Promise<readonly UnreconciledCollectionRow[]> {
  const ctx = await requireTenantContext(OPS)
  const collections = await new FirestorePaytrCollectionRepository(adminDb()).listUnreconciled(ctx)
  return Promise.all(
    collections.map(async (c) => ({
      id: c.id,
      amountKurus: c.amount.amount,
      installments: c.installments,
      buyerName: c.buyerName,
      buyerPhone: c.buyerPhone,
      paidAt: c.paidAt,
      suggestedMember: await matchMember(ctx, c.buyerPhone),
    })),
  )
}

// Attribute a collection to a member: sell the package (KK payment = the collection's money, carrying
// the PAYTR ref), then flip the collection to reconciled + linked. One attributed ledger entry.
export async function reconcileCollectionAction(input: unknown) {
  const p = z
    .object({
      collectionId: z.string().min(1),
      memberId: z.string().min(1),
      productId: z.string().min(1),
      validFrom: z.string().min(1),
      validUntil: z.string().nullable(),
      priceAgreedKurus: z.number().int().min(0).nullable(),
      creditOverride: z.number().int().min(0).nullable(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const collectionRepo = new FirestorePaytrCollectionRepository(adminDb())
  const collection = await collectionRepo.get(ctx, p.collectionId)
  if (!collection || collection.status !== 'unreconciled') {
    return { ok: false as const, error: { code: 'paytr_collection_not_open' as const } }
  }

  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, p.productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }

  const grant: Grant =
    product.type === 'credit'
      ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
      : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }

  const sold = await sellPackage(sellDeps(), ctx, {
    branchId: (ctx.branchIds[0] ?? null) as never,
    subscription: {
      memberId: p.memberId as MemberId,
      productId: product.id,
      productSnapshot: {
        productId: product.id,
        name: product.name,
        category: product.category,
        grant,
        listPrice: money(product.priceInKurus),
        serviceIds: product.serviceIds,
        cancellationAllowanceCount: product.cancellationAllowanceCount,
        dailyReservationLimit: product.dailyReservationLimit,
        activeReservationLimit: product.activeReservationLimit,
      entryAllowance: product.entryAllowance ?? null,
      },
      policyRef: { policyId: product.id, version: 1 },
      priceAgreed: money(p.priceAgreedKurus ?? collection.amount.amount),
      validFrom: dayMs(p.validFrom),
      validUntil: p.validUntil ? dayMs(p.validUntil) : null,
      freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
      creditOverride: p.creditOverride,
      collectedAmount: money(0),
      method: 'credit_card',
      note: 'PAYTR link ödemesi',
    },
    discountCeilingPercent: null,
    // The collection's money, now attributed — recorded once, as a card payment with the PAYTR ref.
    payment: {
      amount: collection.amount,
      method: 'online',
      receivedAt: instant(systemClock.now()),
      drawerId: null,
      giftCardCode: null,
      note: 'PAYTR link ödemesi',
      providerRef: collection.providerRef,
    },
  })
  if (!sold.ok) return sold

  return reconcileCollection(paytrDeps(), ctx, {
    collectionId: p.collectionId,
    memberId: p.memberId as MemberId,
    paymentId: sold.value.paymentId ?? collection.providerRef,
  })
}

// Not ours / a test payment: close it without attributing (a reason is required by the domain).
export async function cancelCollectionAction(input: unknown) {
  const p = z.object({ collectionId: z.string().min(1), reason: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return cancelCollection(paytrDeps(), ctx, { collectionId: p.collectionId, reason: p.reason })
}
