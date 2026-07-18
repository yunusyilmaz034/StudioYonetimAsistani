import {
  newCorrelationId,
  newPaymentLinkId,
  newPaytrCollectionId,
  type Clock,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type Money,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideCancelCollection,
  decideCreatePaymentLink,
  decideDeactivatePaymentLink,
  decideReceiveCollection,
  decideReconcileCollection,
  type DecideContext,
} from '../domain/decide'
import type { PaymentLink, PaytrCollection } from '../domain/types'
import type { FirestorePaymentLinkRepository, FirestorePaytrCollectionRepository } from '../infrastructure/paytr-repos'

// PF-37 — load → decide → save state + event atomically, the same shape as every other use-case.

export interface PaytrDeps {
  readonly linkRepo: FirestorePaymentLinkRepository
  readonly collectionRepo: FirestorePaytrCollectionRepository
  readonly clock: Clock
  readonly source?: EventSource
}

const dc = (deps: PaytrDeps, ctx: TenantContext, now: Instant): DecideContext => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now,
  correlationId: newCorrelationId(),
  source: deps.source ?? 'reception_web',
})

export async function createPaymentLink(
  deps: PaytrDeps,
  ctx: TenantContext,
  input: { readonly label: string; readonly amount: Money; readonly maxInstallments: number },
): Promise<Result<{ linkId: string }, DomainError>> {
  if (input.label.trim().length === 0) return { ok: false, error: { code: 'name_required' } }
  if (input.amount.amount <= 0) return { ok: false, error: { code: 'invalid_amount' } }
  const now = deps.clock.now()
  const link: PaymentLink = {
    id: newPaymentLinkId(),
    studioId: ctx.studioId,
    label: input.label.trim(),
    amount: input.amount,
    maxInstallments: Math.max(1, Math.floor(input.maxInstallments)),
    active: true,
    createdBy: ctx.actor,
    createdAt: now,
  }
  await deps.linkRepo.save(ctx, link, decideCreatePaymentLink(dc(deps, ctx, now), link))
  return { ok: true, value: { linkId: link.id } }
}

export async function deactivatePaymentLink(
  deps: PaytrDeps,
  ctx: TenantContext,
  linkId: string,
): Promise<Result<void, DomainError>> {
  const link = await deps.linkRepo.get(ctx, linkId)
  if (!link) throw new Error(`Payment link not found: ${linkId}`)
  const r = decideDeactivatePaymentLink(dc(deps, ctx, deps.clock.now()), link)
  if (r.events.length > 0) await deps.linkRepo.save(ctx, r.next, r.events)
  return { ok: true, value: undefined }
}

export async function receiveCollection(
  deps: PaytrDeps,
  ctx: TenantContext,
  input: {
    readonly linkId: string
    readonly amount: Money
    readonly installments: number
    readonly buyerName: string
    readonly buyerPhone: string
    readonly providerRef: string
  },
): Promise<{ collectionId: string }> {
  const now = deps.clock.now()
  const collection: PaytrCollection = {
    id: newPaytrCollectionId(),
    studioId: ctx.studioId,
    linkId: input.linkId,
    amount: input.amount,
    installments: input.installments,
    buyerName: input.buyerName,
    buyerPhone: input.buyerPhone,
    providerRef: input.providerRef,
    paidAt: now,
    status: 'unreconciled',
    memberId: null,
    paymentId: null,
    reconciledBy: null,
    reconciledAt: null,
  }
  await deps.collectionRepo.save(ctx, collection, decideReceiveCollection(dc(deps, ctx, now), collection))
  return { collectionId: collection.id }
}

export async function reconcileCollection(
  deps: PaytrDeps,
  ctx: TenantContext,
  input: { readonly collectionId: string; readonly memberId: MemberId; readonly paymentId: string },
): Promise<Result<void, DomainError>> {
  const collection = await deps.collectionRepo.get(ctx, input.collectionId)
  if (!collection) throw new Error(`Collection not found: ${input.collectionId}`)
  const r = decideReconcileCollection(dc(deps, ctx, deps.clock.now()), collection, input.memberId, input.paymentId)
  if (!r.ok) return r
  await deps.collectionRepo.save(ctx, r.value.next, r.value.events)
  return { ok: true, value: undefined }
}

export async function cancelCollection(
  deps: PaytrDeps,
  ctx: TenantContext,
  input: { readonly collectionId: string; readonly reason: string },
): Promise<Result<void, DomainError>> {
  const collection = await deps.collectionRepo.get(ctx, input.collectionId)
  if (!collection) throw new Error(`Collection not found: ${input.collectionId}`)
  const r = decideCancelCollection(dc(deps, ctx, deps.clock.now()), collection, input.reason)
  if (!r.ok) return r
  await deps.collectionRepo.save(ctx, r.value.next, r.value.events)
  return { ok: true, value: undefined }
}
