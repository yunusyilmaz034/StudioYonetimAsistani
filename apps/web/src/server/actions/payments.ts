'use server'

import { randomUUID } from 'node:crypto'

import {
  decideCreatePaymentIntent,
  decideRefundConfirmed,
  decideRequestRefund,
  decideSessionCreated,
  FirestoreCatalogRepository,
  FirestoreMemberRepository,
  FirestorePaymentIntentRepository,
  instant,
  money,
  newCorrelationId,
  systemClock,
  type MemberId,
  type PaymentIntent,
  type ProductId,
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

// COMPLETION and the PAYTR callback handler live in `../payment-callback` (a plain server module, NOT
// `'use server'`): they grant a package from a caller-supplied ctx/intent/verdict and must never be a
// public Server-Action endpoint. See that file for why.

export interface PaymentIntentRow {
  readonly id: string
  readonly purpose: string
  readonly amountKurus: number
  readonly status: string
  readonly provider: string
  readonly providerRef: string
  readonly flow: string
  readonly createdAt: number
}

export async function listMemberPaymentIntentsAction(input: unknown): Promise<readonly PaymentIntentRow[]> {
  const p = z.object({ memberId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const intents = await intentRepo().listByMember(ctx, p.memberId)
  return intents.map((i) => ({
    id: i.id,
    purpose: i.purpose,
    amountKurus: i.amount.amount,
    status: i.status,
    provider: i.provider,
    providerRef: i.providerRef,
    flow: i.flow,
    createdAt: i.createdAt as number,
  }))
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
