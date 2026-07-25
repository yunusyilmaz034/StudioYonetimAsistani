import { createHash, randomBytes } from 'node:crypto'

import {
  collect,
  decideCallbackResult,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  FirestorePaymentIntentRepository,
  FirestorePaymentLinkRepository,
  FirestorePaytrCollectionRepository,
  instant,
  intentIdFor,
  issueMemberInvite,
  money,
  newCorrelationId,
  notify,
  paytrProvider,
  receiveCollection,
  registerMember,
  sellPackage,
  systemClock,
  topUpWallet,
  type BranchId,
  type CallbackVerdict,
  type Grant,
  type MemberId,
  type MembersDeps,
  type PaymentIntent,
  type PaymentIntentContext,
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
// The same dependency builder the notify trigger uses, so an online invite goes out over the SAME real
// providers a booking confirmation does (`notification-retry` imports it from here too).
import { notificationDeps, studioNotificationSettings } from '../triggers/on-event-notify'

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

const membersDeps = (database: Firestore): MembersDeps => ({ repo: new FirestoreMemberRepository(database), clock: systemClock, source: 'system_payment' })

// Online purchase: find-or-create the buyer. registerMember reports the EXISTING member's id on a phone
// collision (AD-40 — never merged), so a new customer is created and an existing one (renewal) reused.
async function resolveBuyer(database: Firestore, ctx: TenantContext, c: PaymentIntentContext): Promise<{ memberId: string; created: boolean } | null> {
  const reg = await registerMember(membersDeps(database), ctx, {
    fullName: (c.buyerName ?? '').trim() || 'Üye',
    phone: c.buyerPhone ?? '',
    homeBranchId: (ctx.branchIds[0] ?? null) as BranchId | null,
    email: c.buyerEmail ?? null,
    birthDate: null,
    notes: 'Online üyelik satışı',
    emergencyContact: null,
  })
  if (reg.ok) return { memberId: reg.value.memberId as string, created: true }
  if (reg.error.code === 'phone_already_registered') return { memberId: (reg.error as { memberId: string }).memberId, created: false }
  return null
}

// A newly-created online buyer has no account yet — mint her portal invite so /invite/{studioId}/{token}
// works and she can set a password, then WhatsApp her the link (blok 2c).
//
// The send happens HERE, not off `member.invited`, because the raw token exists only in this scope: it
// is never stored (only its SHA-256) and never entered the event. Whoever mints the token is the only
// principal that can send a link which actually opens.
async function issueInviteFor(database: Firestore, ctx: TenantContext, memberId: string, intentId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const issued = await issueMemberInvite(membersDeps(database), ctx, { memberId: memberId as MemberId, tokenHash })
  if (!issued.ok) return

  const base = (process.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (!base) {
    // No base URL ⇒ we cannot build a link that opens. Say so loudly rather than send "/invite/…" —
    // reception still sees the pending invite and can send it by hand.
    logger.warn('online invite not sent — PUBLIC_APP_URL is not set', { alert: 'invite_base_url_missing', memberId })
    return
  }

  const member = await new FirestoreMemberRepository(database).findById(ctx, memberId as MemberId)
  if (!member) return

  const settings = await studioNotificationSettings(ctx.studioId)
  const res = await notify(notificationDeps(settings), ctx, {
    // Derived from the payment intent, so a replayed callback finds the intent already there and
    // sends nothing — she must not get the same welcome twice.
    intentId: intentIdFor(intentId, 'portal_invite', memberId),
    eventId: null,
    eventType: 'payment_intent.succeeded',
    operationId: newCorrelationId(),
    templateId: 'portal_invite',
    recipient: {
      kind: 'member',
      id: member.id,
      email: member.email ?? null,
      phone: member.phoneNormalized,
      displayName: member.fullName,
    },
    params: {
      memberName: member.fullName.split(' ')[0] ?? member.fullName,
      inviteLink: `${base}/invite/${encodeURIComponent(ctx.studioId)}/${token}`,
      // Where she goes on every visit AFTER the invite is spent — the invite link is single-use.
      loginLink: `${base}/portal/login?s=${encodeURIComponent(ctx.studioId)}`,
    },
    // She bought the membership on this phone number seconds ago; this message IS the delivery of what
    // she paid for (how she reaches it), not marketing. So the channel is forced rather than left to a
    // preference she has had no chance to set — the same override reception's manual send uses.
    forceChannels: ['whatsapp', 'in_app'],
  })
  if (!res.ok) logger.warn('online invite not sent', { memberId, error: res.error.code })
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

  if (intent.purpose === 'package' || intent.purpose === 'renewal' || intent.purpose === 'public_membership') {
    const product = await new FirestoreCatalogRepository(database).getProduct(ctx, intent.context.productId as ProductId)
    if (!product) return // reconciliation will flag: paid but no product

    // A public purchase may come from someone who is not a member yet — find-or-create her from the
    // buyer context. The staff/member flows already carry a real memberId.
    let memberId = intent.memberId
    let invitee: string | null = null
    if (intent.purpose === 'public_membership') {
      const resolved = await resolveBuyer(database, ctx, intent.context)
      if (!resolved) return // couldn't create — reconciliation flags (paid, no grant)
      memberId = resolved.memberId
      if (resolved.created) invitee = resolved.memberId
    }

    // Hibrit demet: grant one entitlement PER COMPONENT (primary carries the price + the online
    // payment, rest 0). Inline mirror of apps/web/src/server/sell-bundle.ts (DEBT-PAYTR-CALLBACK: two
    // copies kept in sync).
    if (product.components && product.components.length > 0) {
      const overrides = intent.context.componentOverrides ?? null
      const primaryPrice = intent.context.priceAgreedKurus ?? intent.amount.amount
      for (let i = 0; i < product.components.length; i++) {
        const c = product.components[i]!
        const isPrimary = i === 0
        const override = overrides?.[i] ?? null
        const isCredit = c.creditCount != null
        const cGrant: Grant = isCredit
          ? { kind: 'credits', credits: override ?? c.creditCount ?? 0, validForDays: product.durationDays }
          : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }
        const cEntry = isCredit ? c.entryAllowance : override ?? c.entryAllowance
        await sellPackage(sellDeps(database), ctx, {
          branchId: (ctx.branchIds[0] ?? null) as never,
          subscription: {
            memberId: memberId as MemberId,
            productId: product.id,
            productSnapshot: {
              productId: product.id,
              name: product.name,
              category: c.category,
              grant: cGrant,
              listPrice: money(product.priceInKurus),
              serviceIds: product.serviceIds,
              cancellationAllowanceCount: product.cancellationAllowanceCount,
              dailyReservationLimit: product.dailyReservationLimit,
              activeReservationLimit: product.activeReservationLimit,
              entryAllowance: cEntry,
            },
            policyRef: { policyId: product.id, version: 1 },
            priceAgreed: money(isPrimary ? primaryPrice : 0),
            validFrom: dayMs(intent.context.validFrom ?? ''),
            validUntil: intent.context.validUntil ? dayMs(intent.context.validUntil) : null,
            freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
            creditOverride: null,
            collectedAmount: money(0),
            method: 'credit_card',
            note: intent.context.note ?? 'PAYTR',
          },
          discountCeilingPercent: null,
          payment: isPrimary
            ? {
                amount: intent.amount,
                method: 'online',
                receivedAt: instant(systemClock.now()),
                drawerId: null,
                giftCardCode: null,
                note: 'PAYTR',
                providerRef: intent.providerRef,
              }
            : null,
        })
      }
      if (invitee) await issueInviteFor(database, ctx, invitee, intent.id)
      return
    }

    const grant: Grant =
      product.type === 'credit'
        ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
        : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }
    await sellPackage(sellDeps(database), ctx, {
      branchId: (ctx.branchIds[0] ?? null) as never,
      subscription: {
        memberId: memberId as MemberId,
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
    if (invitee) await issueInviteFor(database, ctx, invitee, intent.id)
    return
  }

  // A 'collection' payment — two kinds, told apart by the linkId (mirror of the web tier,
  // DEBT-PAYTR-CALLBACK: two copies kept in sync). Idempotent via the intent status above.
  //   • ATTRIBUTED (no linkId, real memberId) — reception's "Linkle Ödeme" package sale: settle as HER
  //     payment (posts to kasa/ledger + clears her debt automatically, oldest-debt-first).
  //   • UNATTRIBUTED (has a linkId, memberId 'unattributed') — the public PF-37 link; reconciled later.
  if (intent.purpose === 'collection') {
    const attributed = !intent.context.linkId && !!intent.memberId && intent.memberId !== 'unattributed'
    if (attributed) {
      await collect(
        { repo: new FirestoreFinanceRepository(database), clock: systemClock },
        ctx,
        {
          paymentId: `pay_${intent.providerRef.slice(0, 20)}`,
          memberId: intent.memberId as MemberId,
          branchId: (intent.context.branchId ?? ctx.branchIds[0] ?? '') as BranchId,
          amount: intent.amount,
          method: 'online',
          receivedAt: instant(systemClock.now()),
          drawerId: null,
          giftCardCode: null,
          note: 'PAYTR link',
          allowNoDrawer: true,
        },
      )
    } else {
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

  // Doc 27 — a wallet top-up credits her stored-value balance (source 'online'). Idempotent via the
  // intent status above. Mirror of the web tier (DEBT-PAYTR-CALLBACK: two copies kept in sync).
  if (intent.purpose === 'wallet_topup') {
    await topUpWallet(
      { repo: new FirestoreFinanceRepository(database), clock: systemClock, source: 'paytr_callback' },
      ctx,
      { memberId: intent.memberId as MemberId, amount: intent.amount, source: 'online', paymentId: intent.id, providerRef: intent.providerRef },
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
