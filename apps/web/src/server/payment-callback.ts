// PAYTR callback completion — a PLAIN server module, deliberately NOT `'use server'`.
//
// These functions grant a package after payment. They take a fabricated-if-forged `ctx`/`intent`/
// `verdict` and must therefore NEVER be exposed as a Server Action: every export of a `'use server'`
// module is a public, unauthenticated POST endpoint, and `completePaidIntent` has no session guard (a
// PAYTR callback carries no owner session — the HMAC hash IS the authentication). Living here, they are
// importable only by other server code (the callback route), never by the browser. Moving them out of
// `actions/payments.ts` closes a remote, cross-tenant free-grant hole.
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
  FirestoreIdentityRepository,
  intentIdFor,
  issueMemberInvite,
  money,
  newCorrelationId,
  notify,
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
  type ProductId,
  type SellPackageDeps,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'
import { notificationDeps } from './notification-deps'
import { paymentProviderFor } from './payment-provider'
import { getAuth } from 'firebase-admin/auth'

import { grantBundleComponents } from './sell-bundle'

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

const membersDeps = (): MembersDeps => ({ repo: new FirestoreMemberRepository(adminDb()), clock: systemClock, source: 'system_payment' })

// Online purchase: resolve the buyer to a member. registerMember reports the EXISTING member's id on a
// phone collision (AD-40 — never merged), so this is a clean find-or-create — a new customer is created,
// an existing one (a renewal) is reused.
async function resolveBuyer(ctx: TenantContext, c: PaymentIntentContext): Promise<{ memberId: string; created: boolean } | null> {
  const reg = await registerMember(membersDeps(), ctx, {
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
// is never stored (only its SHA-256) and never entered the event. Mirror of the Cloud Function branch
// (DEBT-PAYTR-CALLBACK — the two copies must stay in step).
// ── Telling the studio a sale just happened (owner, 2026-07-27) ─────────────────────────────
//
// "Admini bu durumu mutlaka haber vermelisin — önemli bir durum." He is right, and the gap was
// total: the callback told the MEMBER (her portal invite) and told the studio nothing. A 14.000 ₺
// renewal at 23:00 was discovered by opening the panel the next morning.
//
// Best-effort and last: the money is in and the package is granted by the time this runs. A failed
// notification must never undo a paid sale.
async function tellStudioAboutSale(
  ctx: TenantContext,
  args: { memberId: string; productName: string; amountKurus: number; startsAtMs: number },
): Promise<void> {
  try {
    const db = adminDb()
    const [member, staff] = await Promise.all([
      new FirestoreMemberRepository(db).findById(ctx, args.memberId as MemberId),
      new FirestoreIdentityRepository(db).listStaff(ctx),
    ])
    const desk = staff.filter((m) => m.active && (m.role === 'owner' || m.role === 'receptionist'))
    if (desk.length === 0) return

    const deps = notificationDeps()
    for (const person of desk) {
      let email: string | null = null
      try {
        email = (await getAuth().getUser(person.id as string)).email ?? null
      } catch {
        /* no auth account — in-app still reaches them */
      }
      await notify(deps, ctx, {
        // Keyed on the INTENT: a replayed callback finds it already sent, so one sale is one message.
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
    console.warn('[paytr-callback] studio sale notification failed', (e as Error)?.message)
  }
}

async function issueInviteFor(ctx: TenantContext, memberId: string, intentId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const issued = await issueMemberInvite(membersDeps(), ctx, { memberId: memberId as MemberId, tokenHash })
  if (!issued.ok) return

  const base = (process.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (!base) {
    console.warn('[paytr-callback] online invite not sent — PUBLIC_APP_URL is not set', { memberId })
    return
  }

  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId as MemberId)
  if (!member) return

  const res = await notify(notificationDeps(), ctx, {
    // Derived from the payment intent: a replayed callback finds the intent already there and sends
    // nothing — she must not get the same welcome twice.
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
    // She bought the membership on this phone seconds ago; this message IS the delivery of what she
    // paid for, not marketing — so the channel is forced rather than left to a preference she has had
    // no chance to set.
    forceChannels: ['whatsapp', 'in_app'],
  })
  if (!res.ok) console.warn('[paytr-callback] online invite not sent', { memberId, error: res.error.code })
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

  if (intent.purpose === 'package' || intent.purpose === 'renewal' || intent.purpose === 'public_membership') {
    const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, intent.context.productId as ProductId)
    if (!product) return // reconciliation will flag: paid but no product

    // A public purchase may come from someone who is not a member yet — find-or-create her from the
    // buyer context. The staff/member flows already carry a real memberId.
    let memberId = intent.memberId
    let invitee: string | null = null
    if (intent.purpose === 'public_membership') {
      const resolved = await resolveBuyer(ctx, intent.context)
      if (!resolved) return // couldn't create — reconciliation flags (paid, no grant)
      memberId = resolved.memberId
      if (resolved.created) invitee = resolved.memberId
    }

    // Hibrit demet: grant one entitlement PER COMPONENT; the primary carries the price + the online
    // payment, the rest are granted at 0. Same multi-grant the manual + link paths use.
    if (product.components && product.components.length > 0) {
      await grantBundleComponents(sellDeps(), ctx, {
        product,
        memberId,
        branchId: (ctx.branchIds[0] ?? null) as never,
        primaryPriceKurus: intent.context.priceAgreedKurus ?? intent.amount.amount,
        componentOverrides: intent.context.componentOverrides ?? null,
        validFromMs: dayMs(intent.context.validFrom ?? ''),
        validUntilMs: intent.context.validUntil ? dayMs(intent.context.validUntil) : null,
        method: 'credit_card',
        note: intent.context.note ?? 'PAYTR',
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
      if (invitee) await issueInviteFor(ctx, invitee, intent.id)
      await tellStudioAboutSale(ctx, {
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
    await sellPackage(sellDeps(), ctx, {
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
    if (invitee) await issueInviteFor(ctx, invitee, intent.id)
    await tellStudioAboutSale(ctx, {
      memberId: intent.memberId,
      productName: product.name,
      amountKurus: intent.amount.amount,
      startsAtMs: dayMs(intent.context.validFrom ?? ''),
    })
    return
  }

  if (intent.purpose === 'collection') {
    // TWO kinds of collection share this purpose, told apart by the linkId:
    //   • ATTRIBUTED (no linkId, real memberId) — reception's "Linkle Ödeme" package sale. The member
    //     is known, so the verified money is recorded as HER payment: it posts to the kasa/ledger and
    //     clears her debt AUTOMATICALLY (collect allocates oldest-debt-first).
    //   • UNATTRIBUTED (has a linkId, memberId 'unattributed') — the public PF-37 link; reception
    //     reconciles it to a member later.
    // Idempotent via the intent status above. Mirror of the Cloud Function branch (DEBT-PAYTR-CALLBACK).
    const attributed = !intent.context.linkId && !!intent.memberId && intent.memberId !== 'unattributed'
    if (attributed) {
      await collect(
        { repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock },
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
          linkRepo: new FirestorePaymentLinkRepository(adminDb()),
          collectionRepo: new FirestorePaytrCollectionRepository(adminDb()),
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

  // Doc 27 — a wallet top-up. The verified money credits her stored-value balance (source 'online').
  // Idempotent via the intent status above (a replayed callback returns before here). Mirror of the
  // Cloud Function branch (DEBT-PAYTR-CALLBACK: two copies kept in sync).
  if (intent.purpose === 'wallet_topup') {
    await topUpWallet(
      { repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock, source: 'paytr_callback' },
      ctx,
      { memberId: intent.memberId as MemberId, amount: intent.amount, source: 'online', paymentId: intent.id, providerRef: intent.providerRef },
    )
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


/**
 * BREAK-GLASS — settle an intent the provider took money for but the system did not grant.
 *
 * Lives HERE, beside `completePaidIntent`, because that is the function that grants: a copy of the
 * grant rules in a script or a route would be a second answer to "what does this member own".
 * The caller states what the provider ACTUALLY took; the domain decides. Underpayment is still
 * refused — this completes what was paid, it does not forgive what was not.
 */
export async function settleFlaggedIntent(
  ctx: TenantContext,
  intentId: string,
  paidKurus: number,
  apply: boolean,
): Promise<{ ok: boolean; found: boolean; applied: boolean; intent?: Record<string, unknown> }> {
  const intent = await new FirestorePaymentIntentRepository(adminDb()).getIntent(ctx, intentId)
  if (!intent) return { ok: false, found: false, applied: false }

  const view = {
    status: intent.status,
    failureReason: intent.failureReason,
    expectedKurus: intent.amount.amount,
    providerTookKurus: paidKurus,
    memberId: intent.memberId,
    productId: intent.context.productId,
    validFrom: intent.context.validFrom,
    validUntil: intent.context.validUntil,
  }
  if (!apply) return { ok: true, found: true, applied: false, intent: view }

  await completePaidIntent(ctx, intent, {
    ok: true,
    providerRef: intent.providerRef,
    paidAmount: money(paidKurus),
  })
  return { ok: true, found: true, applied: true, intent: view }
}
