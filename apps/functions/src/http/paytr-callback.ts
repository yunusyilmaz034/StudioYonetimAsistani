import {
  decideCallbackResult,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestorePaymentIntentRepository,
  FirestorePaymentLinkRepository,
  FirestorePaytrCollectionRepository,
  instant,
  money,
  newCorrelationId,
  paytrProvider,
  receiveCollection,
  sellPackage,
  systemClock,
  type CallbackVerdict,
  type Grant,
  type MemberId,
  type PaymentIntent,
  type PaymentProviderPort,
  type ProductId,
  type SellPackageDeps,
  type TenantContext,
} from '@studio/core'
import type { Firestore } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'

import { db } from '../shared/firebase'
import { PAYTR_SECRETS, REGION } from '../shared/region'

// ── PAYTR callback, served from a Cloud Function (2026-07-17) ─────────────────────────────────
//
// WHY IT LIVES HERE, not only in the web tier. PAYTR's notification servers cannot reach our App
// Hosting endpoint (panel.pilatesfitnessbyisil.com → a `35.x` Google load-balancer IP): every
// notification fails with "bağlantı sorunu" and never appears in our access logs, while the same
// endpoint answers a public curl instantly. It is a Google-Cloud reachability quirk of that IP
// range — even a Cloud Function cannot fetch it (GCP does not hairpin egress to its own external
// LB IPs). A Cloud Function's OWN url, however, is fronted by Google's core edge
// (cloudfunctions.net → 216.239.x), which PAYTR can reach. So PAYTR points here.
//
// A proxy that forwards to the web endpoint is therefore impossible (the function can't reach it
// either), so this runs the SAME callback logic directly against Firestore. It is a faithful mirror
// of `apps/web/src/server/payment-callback.ts` — verify the notification hash, look the intent up by
// its provider reference, grant the package idempotently, answer exactly "OK". DEBT-PAYTR-CALLBACK:
// two copies of this orchestration now exist; unify them into `@studio/core`'s payments application
// layer (parameterised by a Firestore instance) so the grant lives in one place again.

const OFFSET_MIN = 180
const DEFAULT_CONFIG = { merchantId: '', testMode: true, active: false }

function dctx(ctx: TenantContext) {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: systemClock.now(),
    correlationId: newCorrelationId(),
    source: 'system_payment' as const,
  }
}
function sellDeps(database: Firestore): SellPackageDeps {
  return {
    finance: { repo: new FirestoreFinanceRepository(database), clock: systemClock },
    entitlements: { repo: new FirestoreEntitlementRepository(database), clock: systemClock },
  }
}
function dayMs(localDate: string): number {
  if (!localDate) return systemClock.now()
  const [y, m, d] = localDate.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - OFFSET_MIN * 60_000
}

// Build the studio's provider from its (non-secret) config doc + the secrets from the environment —
// the same shape as the web tier's `paymentProviderFor`. Absent config/secrets ⇒ Unconfigured, whose
// verifyCallback always fails (a callback is never a grant without a verified hash).
async function providerFor(database: Firestore, sid: string): Promise<PaymentProviderPort> {
  const snap = await database.doc(`studios/${sid}/settings/paymentProvider`).get()
  const config = { ...DEFAULT_CONFIG, ...(snap.exists ? snap.data() : {}) } as {
    merchantId: string
    testMode: boolean
    active: boolean
  }
  const merchantKey = process.env.PAYTR_MERCHANT_KEY
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT
  const usable = config.active && config.merchantId && merchantKey && merchantSalt
  return paytrProvider(
    usable ? { merchantId: config.merchantId, merchantKey, merchantSalt, testMode: config.testMode } : null,
  )
}

// COMPLETION — grants the package after a verified callback. Idempotent via the intent status: a
// replayed callback (PAYTR retries up to 720×) finds it terminal and does nothing. Mirror of
// `completePaidIntent` in the web tier.
async function completePaidIntent(
  database: Firestore,
  ctx: TenantContext,
  intent: PaymentIntent,
  verdict: CallbackVerdict,
): Promise<void> {
  const decided = decideCallbackResult(dctx(ctx), intent, verdict)
  if (!decided.ok) return
  await new FirestorePaymentIntentRepository(database).saveIntent(ctx, decided.value.next, decided.value.events)
  if (!decided.value.completed) return

  if (intent.purpose === 'package' || intent.purpose === 'renewal') {
    const product = await new FirestoreCatalogRepository(database).getProduct(ctx, intent.context.productId as ProductId)
    if (!product) return // reconciliation will flag: paid but no product
    const grant: Grant =
      product.type === 'credit'
        ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
        : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }
    await sellPackage(sellDeps(database), ctx, {
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

  // PF-37 — a shareable-link payment. No member, no product: it becomes an UNATTRIBUTED collection in
  // the kasa, which reception reconciles to a member later. Idempotent via the intent status above
  // (a replayed callback finds it terminal and returns before here).
  if (intent.purpose === 'collection') {
    await receiveCollection(
      {
        linkRepo: new FirestorePaymentLinkRepository(database),
        collectionRepo: new FirestorePaytrCollectionRepository(database),
        clock: systemClock,
        source: 'paytr_callback',
      },
      ctx,
      {
        linkId: intent.context.linkId ?? '',
        amount: intent.amount,
        installments: intent.context.installments ?? 1,
        buyerName: intent.context.buyerName ?? '',
        buyerPhone: intent.context.buyerPhone ?? '',
        providerRef: intent.providerRef,
      },
    )
  }
}

// Verify → load intent by reference → complete. Returns exactly what to send PAYTR ("OK", or PAYTR
// retries). Mirror of `handlePaytrCallback` in the web tier.
async function handle(sid: string, fields: Record<string, string>): Promise<{ body: string; status: number }> {
  const database = db()
  const ctx: TenantContext = {
    studioId: sid as never,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'paytr_callback' } as TenantContext['actor'],
  }
  logger.info('paytr-callback: received', {
    sid,
    merchant_oid: fields.merchant_oid,
    callback_id: fields.callback_id,
    status: fields.status,
    total_amount: fields.total_amount,
    hasHash: Boolean(fields.hash),
  })

  const provider = await providerFor(database, sid)
  const verification = provider.verifyCallback(fields)
  logger.info('paytr-callback: verified', { valid: verification.valid, ref: verification.providerRef, status: verification.status })
  if (!verification.valid || !verification.providerRef) return { body: 'PAYTR notification failed: bad hash', status: 200 }

  const intent = await new FirestorePaymentIntentRepository(database).getIntentByProviderRef(ctx, verification.providerRef)
  if (!intent) {
    logger.warn('paytr-callback: no intent for ref', { ref: verification.providerRef })
    return { body: 'OK', status: 200 } // unknown ref — quarantined, reconciliation surfaces it
  }

  const verdict: CallbackVerdict =
    verification.status === 'success'
      ? { ok: true, providerRef: verification.providerRef, paidAmount: verification.paidAmount ?? money(0) }
      : { ok: false, providerRef: verification.providerRef, reason: verification.failureCode ?? 'failed' }

  try {
    await completePaidIntent(database, ctx, intent, verdict)
  } catch (err) {
    // The money is taken; a completion error must not tell PAYTR "failed". Respond OK; the nightly
    // reconcile grants the package (paid, no entitlement → manual_review / retry).
    logger.error('paytr-callback: completion failed', { ref: verification.providerRef, error: String(err) })
    return { body: 'OK', status: 200 }
  }
  return { body: 'OK', status: 200 }
}

// PAYTR is the caller (public, unauthenticated) — the notification HMAC is the authentication,
// verified inside `handle`. sid rides in the path (…/paytrCallback/{sid}); default to the pilot studio.
export const paytrCallback = onRequest({ region: REGION, secrets: [...PAYTR_SECRETS] }, async (req, res) => {
  const sid = (req.path ?? '').replace(/^\/+/, '').split('/')[0] || 'retro'
  const params = new URLSearchParams(req.rawBody ? req.rawBody.toString('utf8') : '')
  const fields: Record<string, string> = {}
  for (const [k, v] of params) fields[k] = v

  const { body, status } = await handle(sid, fields)
  res.status(status).send(body)
})
