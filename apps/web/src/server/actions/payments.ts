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
  FirestorePaymentLinkRepository,
  FirestoreSchedulingRepository,
  instant,
  money,
  newCorrelationId,
  normalizePhone,
  systemClock,
  type MemberId,
  type PaymentIntent,
  type ProductId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { z } from 'zod'

import { autoSaleNote } from '@/lib/sale-credit-note'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { allowRate } from '../rate-limit'
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
      // The installment cap reception offered for this payment (1 = tek çekim). Clamped to the
      // studio's configured maximum server-side.
      installments: z.number().int().min(1).max(12).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  return createPackageCheckout(ctx, p)
}

export interface PackageCheckoutInput {
  readonly memberId: string
  readonly productId: string
  readonly flow: 'pos' | 'link'
  readonly priceAgreedKurus: number | null
  readonly validFrom: string
  readonly validUntil: string | null
  readonly creditOverride: number | null
  readonly note: string
  readonly installments?: number | undefined
}

// ctx-taking core: BOTH the staff sell (above) and the member self-purchase (member API) run this one
// tested money path — the only difference is who the actor is and where the ctx came from.
export async function createPackageCheckout(ctx: TenantContext, p: PackageCheckoutInput) {
  const { provider, config } = await paymentProviderFor(ctx)
  if (!provider.configured) return { ok: false as const, error: { code: 'payment_provider_not_configured' as const } }

  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, p.productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }

  // KK/havale farkı + taksit — DATA from settings, never a literal. The card price = base + surcharge;
  // priceAgreed (below) becomes that total, so revenue and the member's link both reflect it. The
  // member never sees a breakdown. (TODO(surcharge): the manual cash/havale sell + wallet-membership
  // paths are separate and NOT surcharged here.)
  const studioSettings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  const surchargeKurus = studioSettings?.paymentSurcharge?.cardTransferSurchargeKurus ?? 0
  const maxInstallments = studioSettings?.paymentSurcharge?.maxInstallments ?? 3
  // Kontrol her zaman admin'de: an explicit priceAgreedKurus is the FINAL charged amount, used verbatim
  // (the reception form pre-fills it with price + surcharge and lets the admin override). Only the
  // default (member self-purchase → null) auto-adds the studio surcharge.
  const amount = p.priceAgreedKurus != null ? money(p.priceAgreedKurus) : money(product.priceInKurus + surchargeKurus)
  const installmentCap = Math.min(Math.max(p.installments ?? maxInstallments, 1), maxInstallments)

  const providerRef = randomUUID().replace(/-/g, '') // alphanumeric merchant_oid
  const id = `pin_${providerRef.slice(0, 20)}`
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, p.memberId as MemberId)

  // Auto-fill the audit note when the sale LOWERS the granted credits — the grant (with its credit
  // adjustment, AD-39) runs on the PayTR callback, so an empty note there would fail AFTER the money was
  // taken. Carry a clear reason in the intent context instead.
  const clampedOverride =
    p.creditOverride == null ? null : Math.min(product.creditCount ?? Infinity, Math.max(0, Math.trunc(p.creditOverride)))
  const contextNote = autoSaleNote(product.creditCount, clampedOverride, p.note)

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
      note: contextNote,
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
    maxInstallment: installmentCap,
  })
  if (!checkout.ok || !checkout.redirectUrl) {
    // The provider WAS configured (checked above) — this is a live PAYTR rejection. Surface the real
    // reason; mislabelling it "not configured" sent an hour of debugging at the wrong problem.
    console.error('[paytr] createCheckout failed', { flow: p.flow, reason: checkout.errorCode, testMode: config.testMode })
    return { ok: false as const, error: { code: 'payment_checkout_failed' as const }, providerError: checkout.errorCode }
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

// M3 — a MEMBER buying her own package from the app. memberId comes from her verified token; she picks
// a product and pays via a PAYTR link (opened in-app). Same money path as the staff sell, with sensible
// defaults (list price, today → today+duration, no credit override, single tap of installments).
export async function createMemberPackageCheckout(ctx: TenantContext, memberId: MemberId, productId: string) {
  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }
  const nowTr = new Date(systemClock.now() + 3 * 3_600_000)
  const validFrom = nowTr.toISOString().slice(0, 10)
  const validUntil = product.durationDays > 0 ? new Date(nowTr.getTime() + product.durationDays * 86_400_000).toISOString().slice(0, 10) : null
  return createPackageCheckout(ctx, {
    memberId: memberId as string,
    productId,
    flow: 'link',
    priceAgreedKurus: null,
    validFrom,
    validUntil,
    creditOverride: null,
    note: 'Üye uygulaması',
  })
}

// ── Wallet top-up via virtual POS (Doc 27) — the member loads her stored-value balance. Same PAYTR
//    link flow as a package, but the intent's purpose is 'wallet_topup': it grants NO package. On a
//    verified callback the money becomes a `wallet.topup` (source 'online'), idempotent via the intent.
export async function createWalletTopupCheckout(ctx: TenantContext, memberId: MemberId, amountKurus: number, flow: 'pos' | 'link' = 'link') {
  const { provider, config } = await paymentProviderFor(ctx)
  if (!provider.configured) return { ok: false as const, error: { code: 'payment_provider_not_configured' as const } }
  if (!Number.isInteger(amountKurus) || amountKurus <= 0) return { ok: false as const, error: { code: 'invalid_amount' as const } }

  const providerRef = randomUUID().replace(/-/g, '')
  const id = `pin_${providerRef.slice(0, 20)}`
  const amount = money(amountKurus)
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)

  const intent: PaymentIntent = {
    id,
    studioId: ctx.studioId,
    memberId: memberId as string,
    saleId: `wtop_${providerRef.slice(0, 20)}`, // reserved id; a wallet top-up creates no Sale
    purpose: 'wallet_topup',
    amount,
    provider: 'paytr',
    flow,
    providerRef,
    redirectUrl: null,
    idempotencyKey: providerRef,
    status: 'draft',
    context: { note: 'Cüzdan yükleme' },
    expiresAt: null,
    failureReason: null,
    refundedAmount: money(0),
    createdBy: ctx.actor,
    createdAt: instant(systemClock.now()),
    updatedAt: instant(systemClock.now()),
  }

  const created = decideCreatePaymentIntent(dctx(ctx), intent)
  await intentRepo().saveIntent(ctx, created.next, created.events)

  const checkout = await provider.createCheckout(flow, {
    intentId: id,
    providerRef,
    amount,
    itemName: 'Cüzdan Yükleme',
    memberName: member?.fullName ?? 'Üye',
    memberEmail: (member?.email as string | null) ?? null,
    memberPhone: (member?.phone as string | null) ?? null,
    userIp: '85.34.78.112',
    okUrl: config.successUrl || `${baseUrl(config)}/portal`,
    failUrl: config.failUrl || `${baseUrl(config)}/portal`,
    callbackUrl: callbackUrl(ctx, config),
    testMode: config.testMode,
    expiresInSeconds: 30 * 60,
    maxInstallment: 1,
  })
  if (!checkout.ok || !checkout.redirectUrl) {
    console.error('[paytr] wallet topup checkout failed', { reason: checkout.errorCode, testMode: config.testMode })
    return { ok: false as const, error: { code: 'payment_checkout_failed' as const }, providerError: checkout.errorCode }
  }

  const session = decideSessionCreated(dctx(ctx), created.next, checkout.redirectUrl, checkout.expiresAt ? instant(checkout.expiresAt) : null)
  await intentRepo().saveIntent(ctx, session.next, session.events)
  return { ok: true as const, value: { intentId: id, redirectUrl: checkout.redirectUrl, flow } }
}

// Staff wrapper — reception loads a member's wallet by Sanal POS or Link (in addition to the manual
// cash/havale/manuel buttons). Same verified PAYTR path; on callback the money credits her balance.
export async function createWalletTopupPaymentAction(input: unknown) {
  const p = z.object({ memberId: nonEmpty, amountKurus: z.number().int().min(1), flow: z.enum(['pos', 'link']) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  return createWalletTopupCheckout(ctx, p.memberId as MemberId, p.amountKurus, p.flow)
}

// An ATTRIBUTED collection link/POS — reception sold a package on credit (grant-now, borçlu) and this
// collects the debt from a KNOWN member. Unlike the public PF-37 collection (memberId 'unattributed',
// carries a linkId), this has the real memberId and NO linkId; the callback discriminates on that and
// settles it as HER payment (posts to the kasa/ledger + clears her debt) automatically — no manual
// reconciliation. ctx-taking core (called by the staff action below), same exposure as the wallet core.
export async function createMemberCollectionCheckout(
  ctx: TenantContext,
  args: { memberId: MemberId; amountKurus: number; flow: 'pos' | 'link'; branchId: string | null; note: string; itemName: string },
) {
  const { provider, config } = await paymentProviderFor(ctx)
  if (!provider.configured) return { ok: false as const, error: { code: 'payment_provider_not_configured' as const } }
  if (!Number.isInteger(args.amountKurus) || args.amountKurus <= 0) return { ok: false as const, error: { code: 'invalid_amount' as const } }

  const providerRef = randomUUID().replace(/-/g, '')
  const id = `pin_${providerRef.slice(0, 20)}`
  const amount = money(args.amountKurus)
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, args.memberId)
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  const maxInstallments = settings?.paymentSurcharge?.maxInstallments ?? 3

  const intent: PaymentIntent = {
    id,
    studioId: ctx.studioId,
    memberId: args.memberId as string,
    saleId: `sal_${providerRef.slice(0, 20)}`,
    purpose: 'collection',
    amount,
    provider: 'paytr',
    flow: args.flow,
    providerRef,
    redirectUrl: null,
    idempotencyKey: providerRef,
    status: 'draft',
    context: { note: args.note, ...(args.branchId ? { branchId: args.branchId } : {}) }, // NO linkId ⇒ attributed member payment
    expiresAt: null,
    failureReason: null,
    refundedAmount: money(0),
    createdBy: ctx.actor,
    createdAt: instant(systemClock.now()),
    updatedAt: instant(systemClock.now()),
  }
  const created = decideCreatePaymentIntent(dctx(ctx), intent)
  await intentRepo().saveIntent(ctx, created.next, created.events)

  const checkout = await provider.createCheckout(args.flow, {
    intentId: id,
    providerRef,
    amount,
    itemName: args.itemName,
    memberName: member?.fullName ?? 'Üye',
    memberEmail: (member?.email as string | null) ?? null,
    memberPhone: (member?.phone as string | null) ?? null,
    userIp: '85.34.78.112',
    okUrl: config.successUrl || `${baseUrl(config)}/portal`,
    failUrl: config.failUrl || `${baseUrl(config)}/portal`,
    callbackUrl: callbackUrl(ctx, config),
    testMode: config.testMode,
    expiresInSeconds: 30 * 60,
    maxInstallment: maxInstallments,
  })
  if (!checkout.ok || !checkout.redirectUrl) {
    console.error('[paytr] member collection checkout failed', { flow: args.flow, reason: checkout.errorCode, testMode: config.testMode })
    return { ok: false as const, error: { code: 'payment_checkout_failed' as const }, providerError: checkout.errorCode }
  }

  const session = decideSessionCreated(dctx(ctx), created.next, checkout.redirectUrl, checkout.expiresAt ? instant(checkout.expiresAt) : null)
  await intentRepo().saveIntent(ctx, session.next, session.events)
  return { ok: true as const, value: { intentId: id, redirectUrl: checkout.redirectUrl, flow: args.flow } }
}

// Her own payment history (the staff read is memberId-parameterised and OPS-gated; this derives her id
// from the token). Newest first, only what a receipt would show — no provider internals.
const PURPOSE_TR: Record<string, string> = { package: 'Paket', renewal: 'Yenileme', product: 'Ürün', collection: 'Tahsilat' }
export async function memberPaymentHistory(
  ctx: TenantContext,
  memberId: MemberId,
): Promise<{ id: string; amount: number; method: string; at: number; description: string }[]> {
  const intents = await intentRepo().listByMember(ctx, memberId as string)
  return intents
    .filter((i) => i.status === 'paid')
    .map((i) => ({ id: i.id, amount: i.amount.amount, method: 'Kredi Kartı', at: Number(i.createdAt), description: PURPOSE_TR[i.purpose] ?? i.purpose }))
    .sort((a, b) => b.at - a.at)
}

// ── PF-37: PUBLIC payment-link collection. UNAUTHENTICATED — anyone with the link may pay. ─────
// A powerless system context (like the portal invite) builds Admin-SDK paths; the payer has no session.
// It loads the link's FIXED amount + installment cap, and creates a `collection` intent that carries
// the buyer's OWN details (name/phone she typed here, never from PAYTR). NO member, NO product. The
// verified callback turns the paid intent into an unattributed kasa collection, which reception
// reconciles to a member. Errors are plain strings (public flow), not DomainError.
const publicCtx = (studioId: string): TenantContext => ({
  studioId: studioId as StudioId,
  branchIds: [],
  role: 'member',
  actor: { type: 'system', id: 'sys_payment_link' as never },
})

export async function getPaymentLinkPublicAction(input: unknown) {
  const p = z.object({ studioId: nonEmpty, linkId: nonEmpty }).parse(input)
  const ctx = publicCtx(p.studioId)
  const [link, settings] = await Promise.all([
    new FirestorePaymentLinkRepository(adminDb()).get(ctx, p.linkId),
    new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx),
  ])
  // The name a customer knows the studio by — the one shown on the link's WhatsApp preview and the page.
  const studioName = settings?.company?.displayName || settings?.company?.legalName || 'Stüdyo'
  if (!link || !link.active) return { ok: false as const, studioName }
  // No PII, no studio secrets — only what the public page must render.
  return {
    ok: true as const,
    studioName,
    value: { label: link.label, amountKurus: link.amount.amount, maxInstallments: link.maxInstallments },
  }
}

export async function createCollectionCheckoutAction(input: unknown) {
  const p = z
    .object({
      studioId: nonEmpty,
      linkId: nonEmpty,
      buyerName: z.string().trim().min(2).max(120),
      buyerPhone: z.string().trim().min(7),
    })
    .parse(input)
  const ctx = publicCtx(p.studioId)

  // This is the ONE unauthenticated write in the app — throttle it per IP so the public form can't be
  // spammed into thousands of bogus PaymentIntents (12/hour is far above any real buyer).
  if (!(await allowRate(p.studioId, 'pay_checkout', 12, 60 * 60 * 1000))) return { ok: false as const, reason: 'rate_limited' as const }

  const link = await new FirestorePaymentLinkRepository(adminDb()).get(ctx, p.linkId)
  if (!link || !link.active) return { ok: false as const, reason: 'unavailable' as const }

  const phone = normalizePhone(p.buyerPhone)
  if (!phone.ok) return { ok: false as const, reason: 'invalid_phone' as const }

  const { provider, config } = await paymentProviderFor(ctx)
  if (!provider.configured) return { ok: false as const, reason: 'not_configured' as const }

  const providerRef = randomUUID().replace(/-/g, '')
  const id = `pin_${providerRef.slice(0, 20)}`
  const intent: PaymentIntent = {
    id,
    studioId: ctx.studioId,
    memberId: 'unattributed',
    saleId: `sal_${providerRef.slice(0, 20)}`,
    purpose: 'collection',
    amount: link.amount,
    provider: 'paytr',
    flow: 'link',
    providerRef,
    redirectUrl: null,
    idempotencyKey: providerRef,
    status: 'draft',
    context: { linkId: link.id, buyerName: p.buyerName.trim(), buyerPhone: phone.value.e164, installments: link.maxInstallments },
    expiresAt: null,
    failureReason: null,
    refundedAmount: money(0),
    createdBy: ctx.actor,
    createdAt: instant(systemClock.now()),
    updatedAt: instant(systemClock.now()),
  }
  const created = decideCreatePaymentIntent(dctx(ctx), intent)
  await intentRepo().saveIntent(ctx, created.next, created.events)

  const checkout = await provider.createCheckout('link', {
    intentId: id,
    providerRef,
    amount: link.amount,
    itemName: link.label,
    memberName: p.buyerName.trim(),
    memberEmail: null,
    memberPhone: phone.value.e164,
    userIp: '85.34.78.112',
    okUrl: `${baseUrl(config)}/pay/${link.id}?ok=1`,
    failUrl: `${baseUrl(config)}/pay/${link.id}?fail=1`,
    callbackUrl: callbackUrl(ctx, config),
    testMode: config.testMode,
    expiresInSeconds: 30 * 60,
    maxInstallment: link.maxInstallments,
  })
  if (!checkout.ok || !checkout.redirectUrl) return { ok: false as const, reason: 'checkout_failed' as const }

  const session = decideSessionCreated(dctx(ctx), created.next, checkout.redirectUrl, checkout.expiresAt ? instant(checkout.expiresAt) : null)
  await intentRepo().saveIntent(ctx, session.next, session.events)
  return { ok: true as const, redirectUrl: checkout.redirectUrl }
}

function baseUrl(config: { callbackUrl: string }): string {
  try {
    return new URL(config.callbackUrl).origin
  } catch {
    return ''
  }
}
function callbackUrl(ctx: TenantContext, config: { callbackUrl: string }): string {
  // sid rides in the PATH, not a query string: PAYTR does not reliably call back a callback_link that
  // carries a `?…` query, so the link would be created but no notification ever sent. `…/callback/{sid}`.
  const base = config.callbackUrl || `${baseUrl(config)}/api/payments/paytr/callback`
  const clean = (base.split('?')[0] ?? base).replace(/\/+$/, '')
  return `${clean}/${ctx.studioId}`
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
