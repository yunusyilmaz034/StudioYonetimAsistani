'use server'

import { randomUUID } from 'node:crypto'

import {
  decideCallbackResult,
  decideCreatePaymentIntent,
  decideRefundConfirmed,
  decideRequestRefund,
  decideSessionCreated,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
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
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { getPaymentProviderConfig, paymentProviderFor, paymentSecretsPresent, DEFAULT_PAYMENT_CONFIG } from '../payment-provider'

const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const
const nonEmpty = z.string().trim().min(1)

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

// ── Provider config (Ayarlar › Entegrasyonlar › Payment Providers) ───────────────────────────
export async function getPaymentProviderSettingsAction() {
  const ctx = await requireTenantContext(OPS)
  const config = await getPaymentProviderConfig(ctx)
  // Never reveal a secret — only whether it is provisioned.
  return { config, secretsPresent: paymentSecretsPresent() }
}

export async function updatePaymentProviderSettingsAction(input: unknown) {
  const p = z
    .object({
      merchantId: z.string(),
      testMode: z.boolean(),
      callbackUrl: z.string(),
      successUrl: z.string(),
      failUrl: z.string(),
      posEnabled: z.boolean(),
      linkEnabled: z.boolean(),
      active: z.boolean(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  await adminDb()
    .doc(`studios/${ctx.studioId}/settings/paymentProvider`)
    .set({ ...DEFAULT_PAYMENT_CONFIG, ...p, provider: 'paytr' }, { merge: true })
  return { ok: true as const }
}

// "Bağlantıyı Test Et" — a truthful readiness check. It does NOT charge anything; it reports whether
// the config + secrets are all present so the provider would be REAL rather than Unconfigured.
export async function testPaymentProviderAction() {
  const ctx = await requireTenantContext(OWNER)
  const { provider, config } = await paymentProviderFor(ctx)
  if (provider.configured) return { ok: true as const, message: 'PAYTR bağlantısı yapılandırılmış (canlı gönderime hazır).' }
  const missing: string[] = []
  if (!config.active) missing.push('Aktif değil')
  if (!config.merchantId) missing.push('Merchant ID')
  if (!paymentSecretsPresent()) missing.push('Merchant Key/Salt (Secret Manager)')
  return { ok: false as const, message: `Eksik yapılandırma: ${missing.join(', ')}` }
}

// ── Start a PAYTR payment for a PACKAGE (Sanal POS or Link). The entitlement is NOT granted here —
//    only on the verified callback (spec §4/§8). Price is recomputed from the catalogue on the
//    server, never the client's number (§16). ──
export async function createPackagePaymentAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      productId: nonEmpty,
      flow: z.enum(['pos', 'link']),
      priceAgreedKurus: z.number().int().min(1).nullable(),
      validFrom: z.string().min(1),
      validUntil: z.string().nullable(),
      creditOverride: z.number().int().min(0).nullable(),
      note: z.string().default(''),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const { provider, config } = await paymentProviderFor(ctx)
  if (!provider.configured) return { ok: false as const, error: { code: 'payment_provider_not_configured' as const } }

  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, p.productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }
  const amount = money(p.priceAgreedKurus ?? product.priceInKurus)

  const providerRef = randomUUID().replace(/-/g, '') // alphanumeric merchant_oid
  const id = `pin_${providerRef.slice(0, 20)}`
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, p.memberId as MemberId)

  const intent: PaymentIntent = {
    id,
    studioId: ctx.studioId,
    memberId: p.memberId,
    saleId: `sal_${providerRef.slice(0, 20)}`,
    purpose: 'package',
    amount,
    provider: 'paytr',
    flow: p.flow,
    providerRef,
    redirectUrl: null,
    idempotencyKey: providerRef,
    status: 'draft',
    context: {
      productId: product.id as string,
      priceAgreedKurus: amount.amount,
      validFrom: p.validFrom,
      validUntil: p.validUntil,
      creditOverride: p.creditOverride,
      note: p.note,
    },
    expiresAt: null,
    failureReason: null,
    refundedAmount: money(0),
    createdBy: ctx.actor,
    createdAt: instant(systemClock.now()),
    updatedAt: instant(systemClock.now()),
  }

  const created = decideCreatePaymentIntent(dctx(ctx), intent)
  await intentRepo().saveIntent(ctx, created.next, created.events)

  const checkout = await provider.createCheckout(p.flow, {
    intentId: id,
    providerRef,
    amount,
    itemName: product.name,
    memberName: member?.fullName ?? 'Üye',
    memberEmail: (member?.email as string | null) ?? null,
    memberPhone: (member?.phone as string | null) ?? null,
    userIp: '85.34.78.112', // server-side placeholder; PAYTR requires a value, refined at the edge
    okUrl: config.successUrl || `${baseUrl(config)}/portal`,
    failUrl: config.failUrl || `${baseUrl(config)}/portal`,
    callbackUrl: callbackUrl(ctx, config),
    testMode: config.testMode,
    expiresInSeconds: 30 * 60,
  })
  if (!checkout.ok || !checkout.redirectUrl) {
    return { ok: false as const, error: { code: 'payment_provider_not_configured' as const }, providerError: checkout.errorCode }
  }

  const session = decideSessionCreated(
    dctx(ctx),
    created.next,
    checkout.redirectUrl,
    checkout.expiresAt ? instant(checkout.expiresAt) : null,
  )
  await intentRepo().saveIntent(ctx, session.next, session.events)
  return { ok: true as const, value: { intentId: id, redirectUrl: checkout.redirectUrl, flow: p.flow } }
}

function baseUrl(config: { callbackUrl: string }): string {
  try {
    return new URL(config.callbackUrl).origin
  } catch {
    return ''
  }
}
function callbackUrl(ctx: TenantContext, config: { callbackUrl: string }): string {
  const base = config.callbackUrl || `${baseUrl(config)}/api/payments/paytr/callback`
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}sid=${ctx.studioId}`
}

// ── COMPLETION — called by the verified callback route ONLY (not a client). Grants the package after
//    payment, records the online payment in the ledger with the real providerRef. Idempotent via the
//    intent status (a replayed callback finds it terminal and does nothing). ──
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

// ── Refund a PAYTR payment (Plus Phase 6, §12). Owner only. Requests the refund at the provider;
//    a refund is a NEW event, never an edit — over-refund is refused. When the provider is not
//    configured, the STATE model is complete but nothing is faked: configuration_required. The
//    ledger reversal (the finance Payment) is the owner's existing finance refund, matched by
//    providerRef. ──
export async function refundPaymentIntentAction(input: unknown) {
  const p = z.object({ intentId: nonEmpty, amountKurus: z.number().int().min(1), reason: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const intent = await intentRepo().getIntent(ctx, p.intentId)
  if (!intent) return { ok: false as const, error: { code: 'payment_ref_mismatch' as const } }

  const requested = decideRequestRefund(dctx(ctx), intent, money(p.amountKurus), p.reason)
  if (!requested.ok) return requested
  await intentRepo().saveIntent(ctx, requested.value.next, requested.value.events)

  const { provider } = await paymentProviderFor(ctx)
  if (!provider.configured) return { ok: false as const, error: { code: 'payment_provider_not_configured' as const } }

  const res = await provider.refund({ providerRef: intent.providerRef, amount: money(p.amountKurus) })
  if (!res.ok) return { ok: false as const, error: { code: 'payment_not_refundable' as const }, providerError: res.errorCode }

  const confirmed = decideRefundConfirmed(dctx(ctx), requested.value.next, money(p.amountKurus), p.reason)
  await intentRepo().saveIntent(ctx, confirmed.next, confirmed.events)
  return { ok: true as const }
}

// ── The PAYTR callback, server-side (the route only forwards to this — depcruise keeps Firestore out
//    of app/api). Verify → load intent by reference → complete. Returns exactly what to send PAYTR. ──
export async function handlePaytrCallback(sid: string, fields: Record<string, string>): Promise<{ body: string; status: number }> {
  const ctx: TenantContext = {
    studioId: sid as never,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'paytr_callback' } as TenantContext['actor'],
  }
  const { provider } = await paymentProviderFor(ctx)
  const verification = provider.verifyCallback(fields)
  if (!verification.valid || !verification.providerRef) return { body: 'PAYTR notification failed: bad hash', status: 200 }

  const intent = await intentRepo().getIntentByProviderRef(ctx, verification.providerRef)
  if (!intent) return { body: 'OK', status: 200 } // unknown ref — quarantined, reconciliation surfaces it

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

const MS_PER_DAY = 86_400_000
const OFFSET_MIN = 180
function dayMs(localDate: string): number {
  return Date.parse(`${localDate}T00:00:00Z`) - OFFSET_MIN * 60_000
}
export { MS_PER_DAY }
