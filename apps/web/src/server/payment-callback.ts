// PAYTR callback completion — a PLAIN server module, deliberately NOT `'use server'`.
//
// These functions grant a package after payment. They take a fabricated-if-forged `ctx`/`intent`/
// `verdict` and must therefore NEVER be exposed as a Server Action: every export of a `'use server'`
// module is a public, unauthenticated POST endpoint, and `completePaidIntent` has no session guard (a
// PAYTR callback carries no owner session — the HMAC hash IS the authentication). Living here, they are
// importable only by other server code (the callback route), never by the browser. Moving them out of
// `actions/payments.ts` closes a remote, cross-tenant free-grant hole.
import {
  decideCallbackResult,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestorePaymentIntentRepository,
  instant,
  money,
  newCorrelationId,
  sellPackage,
  systemClock,
  type CallbackVerdict,
  type Grant,
  type MemberId,
  type PaymentIntent,
  type ProductId,
  type SellPackageDeps,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'
import { paymentProviderFor } from './payment-provider'

const OFFSET_MIN = 180
const intentRepo = () => new FirestorePaymentIntentRepository(adminDb())
const dctx = (ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: systemClock.now(),
  correlationId: newCorrelationId(),
  source: 'system_payment' as const,
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

// COMPLETION — called by the verified callback route ONLY (not a client). Grants the package after
// payment, records the online payment in the ledger with the real providerRef. Idempotent via the
// intent status (a replayed callback finds it terminal and does nothing).
//
// NOTE (DEBT-038): the intent read (in handlePaytrCallback) and this write are not one transaction, so
// two genuinely concurrent duplicate callbacks could both observe awaiting_payment and double-grant.
// PAYTR retries are mostly sequential, and PAYTR is not live (no credentials), so this is not reachable
// in production today; it must be made transactional before PAYTR is switched on.
export async function completePaidIntent(ctx: TenantContext, intent: PaymentIntent, verdict: CallbackVerdict): Promise<void> {
  const decided = decideCallbackResult(dctx(ctx), intent, verdict)
  if (!decided.ok) return
  await intentRepo().saveIntent(ctx, decided.value.next, decided.value.events)
  if (!decided.value.completed) return

  if (intent.purpose === 'package' || intent.purpose === 'renewal') {
    const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, intent.context.productId as ProductId)
    if (!product) return // reconciliation will flag: paid but no product
    const grant: Grant =
      product.type === 'credit'
        ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
        : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }
    await sellPackage(sellDeps(), ctx, {
      branchId: (ctx.branchIds[0] ?? null) as never,
      subscription: {
        memberId: intent.memberId as MemberId,
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
        },
        policyRef: { policyId: product.id, version: 1 },
        priceAgreed: money(intent.context.priceAgreedKurus ?? intent.amount.amount),
        validFrom: dayMs(intent.context.validFrom ?? ''),
        validUntil: intent.context.validUntil ? dayMs(intent.context.validUntil) : null,
        freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
        creditOverride: intent.context.creditOverride ?? null,
        collectedAmount: money(0),
        // The entitlement's own (informational) method enum has no 'online'; the real money method is
        // on the finance payment below (method: 'online'). collectedAmount is zeroed, so this is inert.
        method: 'credit_card',
        note: intent.context.note ?? 'PAYTR',
      },
      discountCeilingPercent: null,
      payment: {
        amount: intent.amount,
        method: 'online',
        receivedAt: instant(systemClock.now()),
        drawerId: null,
        giftCardCode: null,
        note: 'PAYTR',
        providerRef: intent.providerRef,
      },
    })
  }
}

// The PAYTR callback, server-side (the route only forwards to this — depcruise keeps Firestore out of
// app/api). Verify → load intent by reference → complete. Returns exactly what to send PAYTR.
export async function handlePaytrCallback(sid: string, fields: Record<string, string>): Promise<{ body: string; status: number }> {
  const ctx: TenantContext = {
    studioId: sid as never,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'paytr_callback' } as TenantContext['actor'],
  }
  console.log('[paytr-callback] received', {
    sid,
    merchant_oid: fields.merchant_oid,
    callback_id: fields.callback_id,
    status: fields.status,
    total_amount: fields.total_amount,
    hasHash: Boolean(fields.hash),
  })
  const { provider } = await paymentProviderFor(ctx)
  const verification = provider.verifyCallback(fields)
  console.log('[paytr-callback] verified', { valid: verification.valid, ref: verification.providerRef, status: verification.status })
  if (!verification.valid || !verification.providerRef) return { body: 'PAYTR notification failed: bad hash', status: 200 }

  const intent = await intentRepo().getIntentByProviderRef(ctx, verification.providerRef)
  if (!intent) {
    console.warn('[paytr-callback] no intent for ref', verification.providerRef)
    return { body: 'OK', status: 200 } // unknown ref — quarantined, reconciliation surfaces it
  }
  console.log('[paytr-callback] granting', { intent: intent.id, status: verification.status })

  const verdict: CallbackVerdict =
    verification.status === 'success'
      ? { ok: true, providerRef: verification.providerRef, paidAmount: verification.paidAmount ?? money(0) }
      : { ok: false, providerRef: verification.providerRef, reason: verification.failureCode ?? 'failed' }

  try {
    await completePaidIntent(ctx, intent, verdict)
  } catch {
    // The money is taken; a completion error must not tell PAYTR "failed". Respond OK; reconciliation
    // grants the package (paid, no entitlement → manual_review / retry, §21/§22).
    return { body: 'OK', status: 200 }
  }
  return { body: 'OK', status: 200 }
}
