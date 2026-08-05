import { createHash, randomBytes } from 'node:crypto'

import {
  collect,
  decideCallbackResult,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreIdentityRepository,
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
  sellPackage,
  systemClock,
  topUpWallet,
  type BranchId,
  type CallbackVerdict,
  type Grant,
  type MemberId,
  type MembersDeps,
  type PaymentIntent,
  type PaymentProviderPort,
  type ProductId,
  type SellPackageDeps,
  type TenantContext,
} from '@studio/core'
import type { Firestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
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

// A newly-created online buyer has no account yet — mint her portal invite so /invite/{studioId}/{token}
// works and she can set a password, then WhatsApp her the link (blok 2c).
//
// The send happens HERE, not off `member.invited`, because the raw token exists only in this scope: it
// is never stored (only its SHA-256) and never entered the event. Whoever mints the token is the only
// principal that can send a link which actually opens.
// ── Telling the studio a sale just happened (owner, 2026-07-27) ─────────────────────────────
//
// "Admini bu durumu mutlaka haber vermelisin." Before this the callback told the MEMBER (her portal
// invite) and the studio nothing: a renewal at 23:00 was discovered by opening the panel next
// morning.
//
// It was first written into the WEB copy of this file — and the web copy is not the one PAYTR calls.
// DEBT-PAYTR-CALLBACK says the two must stay in step; this is what that costs when they do not.
//
// Best-effort and last: the money is in and the package is granted by the time this runs. A failed
// notification must never undo a paid sale.
// ── ONLINE SATIŞ: somebody just paid and is now waiting on a human ───────────────────────────
//
// Sent instead of the sale notice, because there is no member to name yet — the buyer's name comes
// off the intent's own context, which is state, not an event (#6). Worded as a task, not good news:
// money has been taken and nothing is delivered until reception acts.
async function tellStudioAboutPendingOnlineSale(database: Firestore, ctx: TenantContext, intent: PaymentIntent): Promise<void> {
  try {
    const [staff, settings] = await Promise.all([
      new FirestoreIdentityRepository(database).listStaff(ctx),
      studioNotificationSettings(ctx.studioId),
    ])
    const desk = staff.filter((m: { active: boolean; role: string }) => m.active && (m.role === 'owner' || m.role === 'receptionist'))
    if (desk.length === 0) return

    const deps = notificationDeps(settings)
    for (const person of desk) {
      let email: string | null = null
      try {
        email = (await getAuth().getUser(person.id as string)).email ?? null
      } catch {
        /* no auth account — in-app still reaches them */
      }
      await notify(deps, ctx, {
        // Keyed on the INTENT, so a replayed callback re-sends nothing: one purchase, one task.
        intentId: intentIdFor(intent.id, 'sale_self_service', 'pending').slice(0, 180),
        eventId: null,
        eventType: 'payment_intent.succeeded',
        operationId: newCorrelationId(),
        templateId: 'sale_self_service',
        recipient: { kind: 'staff', id: person.id as string, email, phone: null, displayName: person.displayName },
        params: {
          memberName: intent.context.buyerName ?? 'Yeni alıcı',
          productName: intent.context.note ?? 'Online üyelik',
          amount: `${(intent.amount.amount / 100).toLocaleString('tr-TR')} ₺`,
          startsOn: 'üyelik oluşturulmayı bekliyor',
        },
      })
    }
  } catch (e) {
    logger.warn('[paytr-callback] pending online sale notification failed', (e as Error)?.message)
  }
}

async function tellStudioAboutSale(
  database: Firestore,
  ctx: TenantContext,
  args: { memberId: string; productName: string; amountKurus: number; startsAtMs: number },
): Promise<void> {
  try {
    const [member, staff, settings] = await Promise.all([
      new FirestoreMemberRepository(database).findById(ctx, args.memberId as MemberId),
      new FirestoreIdentityRepository(database).listStaff(ctx),
      studioNotificationSettings(ctx.studioId),
    ])
    const desk = staff.filter((m: { active: boolean; role: string }) => m.active && (m.role === 'owner' || m.role === 'receptionist'))
    if (desk.length === 0) return

    const deps = notificationDeps(settings)
    for (const person of desk) {
      let email: string | null = null
      try {
        email = (await getAuth().getUser(person.id as string)).email ?? null
      } catch {
        /* no auth account — in-app still reaches them */
      }
      await notify(deps, ctx, {
        // Keyed on the member + start date: a replayed callback sends nothing twice.
        intentId: intentIdFor(args.memberId, 'sale_self_service', String(args.startsAtMs)).slice(0, 180),
        eventId: null,
        eventType: 'payment_intent.succeeded',
        operationId: newCorrelationId(),
        templateId: 'sale_self_service',
        recipient: { kind: 'staff', id: person.id as string, email, phone: null, displayName: person.displayName },
        params: {
          memberName: member?.fullName ?? 'Üye',
          productName: args.productName,
          amount: `${(args.amountKurus / 100).toLocaleString('tr-TR')} ₺`,
          startsOn: new Date(args.startsAtMs).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }),
        },
      })
    }
  } catch (e) {
    logger.warn('[paytr-callback] studio sale notification failed', (e as Error)?.message)
  }
}

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

  // ── ONLINE SATIŞ stops here (owner, 2026-08-05). ──
  //
  // The money is in and recorded; the MEMBERSHIP is not. Who the buyer is — someone new, or someone
  // already on the books under that phone — is reception's judgement, made on the dashboard. Until
  // then the intent stands as paid-and-unfulfilled, which the panel shouts about rather than hides.
  //
  // Mirror of apps/web/src/server/payment-callback.ts (DEBT-PAYTR-CALLBACK: two copies, and PAYTR
  // calls THIS one — OR-16). Changing one without the other is how a live purchase silently keeps
  // the old behaviour.
  if (intent.purpose === 'public_membership') {
    await tellStudioAboutPendingOnlineSale(database, ctx, intent)
    return
  }

  if (intent.purpose === 'package' || intent.purpose === 'renewal') {
    const product = await new FirestoreCatalogRepository(database).getProduct(ctx, intent.context.productId as ProductId)
    if (!product) return // reconciliation will flag: paid but no product

    const memberId = intent.memberId
    const invitee: string | null = null

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
      await tellStudioAboutSale(database, ctx, {
        memberId: intent.memberId,
        productName: product.name,
        amountKurus: intent.amount.amount,
        startsAtMs: dayMs(intent.context.validFrom ?? ''),
      })
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
    await tellStudioAboutSale(database, ctx, {
      memberId: intent.memberId,
      productName: product.name,
      amountKurus: intent.amount.amount,
      startsAtMs: dayMs(intent.context.validFrom ?? ''),
    })
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
// ── BREAK-GLASS: settle a payment the provider took and the system refused ───────────────────
//
// An intent sits in `manual_review` — card charged, no package — and until now there was no way to
// resolve one anywhere in the product. The instalment bug created two within minutes of self-service
// checkout going live, and the honest answer to "how do we fix this member's order" was "edit
// Firestore by hand", which this codebase forbids for a reason that shows up exactly here: an
// entitlement with no event behind it is indistinguishable, forever, from one somebody granted
// themselves.
//
// It lives HERE, in the function, and not in the web app — which is where it was first written, and
// wrong. This is the callback PAYTR actually calls; `completePaidIntent` above is the code that
// grants. Anywhere else and it is either a third copy of the grant rules or a status flip that
// clears the flag without granting, which is worse than the flag: it removes the only sign that a
// member paid for nothing.
//
// The operator states what the provider ACTUALLY took; the domain decides from there. Underpayment
// is still refused — this completes what was paid, it does not forgive what was not. Nothing is
// written without `apply=1`.
//
//   POST /paytrCallback/<sid>?admin=settle&intent=pin_…&paid=<kuruş>&reason=…&token=…[&apply=1]
async function breakGlassSettle(
  sid: string,
  q: Record<string, string | undefined>,
): Promise<{ body: string; status: number }> {
  const intentId = q.intent ?? ''
  const paid = Number(q.paid ?? '')
  const reason = (q.reason ?? '').trim()
  const apply = q.apply === '1'
  if (!intentId || !Number.isInteger(paid) || paid <= 0 || reason.length < 8) {
    return { body: JSON.stringify({ ok: false, error: 'usage: ?admin=settle&intent=&paid=<kuruş>&reason=&token=[&apply=1]' }), status: 400 }
  }

  const database = db()
  const ctx: TenantContext = {
    studioId: sid as TenantContext['studioId'],
    branchIds: [],
    role: 'owner',
    // The truth about who did this. A hand-settled payment must never be indistinguishable from a
    // provider callback in the log.
    actor: { type: 'platform_admin', id: 'break_glass' } as TenantContext['actor'],
  }

  const intent = await new FirestorePaymentIntentRepository(database).getIntent(ctx, intentId)
  if (!intent) return { body: JSON.stringify({ ok: false, error: 'intent_not_found' }), status: 404 }

  const view = {
    status: intent.status,
    failureReason: intent.failureReason,
    expectedKurus: intent.amount.amount,
    providerTookKurus: paid,
    memberId: intent.memberId,
    productId: intent.context.productId,
    validFrom: intent.context.validFrom,
    validUntil: intent.context.validUntil,
  }
  if (!apply) return { body: JSON.stringify({ ok: true, dryRun: true, intent: view, reason }), status: 200 }

  logger.warn('[paytr-callback] BREAK-GLASS settle', { intent: intentId, paid, reason, sid })
  await completePaidIntent(database, ctx, intent, {
    ok: true,
    providerRef: intent.providerRef,
    paidAmount: money(paid),
  })
  return { body: JSON.stringify({ ok: true, applied: true, intent: view, reason }), status: 200 }
}

export const paytrCallback = onRequest({ region: REGION, secrets: [...PAYTR_SECRETS] }, async (req, res) => {
  const sid = (req.path ?? '').replace(/^\/+/, '').split('/')[0] || 'retro'
  const params = new URLSearchParams(req.rawBody ? req.rawBody.toString('utf8') : '')
  const fields: Record<string, string> = {}
  for (const [k, v] of params) fields[k] = v

  // Break-glass first: it is a POST like the callback, told apart by `admin=settle` and gated by the
  // same token the WhatsApp resume endpoint uses. Deliberately NOT a separate function — it must sit
  // next to the grant code it calls.
  if (req.query.admin === 'settle') {
    if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(403).send(JSON.stringify({ ok: false, error: 'forbidden' }))
      return
    }
    const q: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(req.query)) q[k] = typeof v === 'string' ? v : undefined
    const out = await breakGlassSettle(sid, q)
    res.status(out.status).send(out.body)
    return
  }

  const { body, status } = await handle(sid, fields)
  res.status(status).send(body)
})
