'use server'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreReservationRepository,
  freezeDaysRemaining,
  freezeEntitlement,
  localDateAt,
  unfreezeEntitlement,
  adjustCredits,
  amendEntitlement,
  available,
  cancelEntitlement,
  cardSurchargeKurus,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreSchedulingRepository,
  instant,
  money,
  reactivateEntitlement,
  moneyByEntitlement,
  sellPackage,
  systemClock,
  type AmendPatch,
  type AssignSubscriptionInput,
  type BranchId,
  type SellPackageDeps,
  type EntitlementId,
  type EntitlementsDeps,
  type Grant,
  type MemberId,
  type PaymentMethod,
  type ProductId,
} from '@studio/core'
import { z } from 'zod'

import { autoSaleNote } from '@/lib/sale-credit-note'

import { requireTenantContext } from '../auth'
import { observed } from '../log'
import { adminDb } from '../firebase-admin'
import { createMemberCollectionCheckout } from './payments'

// Selling (assign) is owner + receptionist + platform_admin (Doc 13). Cancelling is
// owner + platform_admin. Reads are gated the same as selling.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const CANCEL = ['owner', 'platform_admin'] as const
const STUDIO_UTC_OFFSET_MIN = 180
const nonEmpty = z.string().min(1)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const method = z.enum(['cash', 'credit_card', 'bank_transfer'])

const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`) - STUDIO_UTC_OFFSET_MIN * 60_000

function entDeps(): EntitlementsDeps {
  return { repo: new FirestoreEntitlementRepository(adminDb()), clock: systemClock }
}

function sellDeps(): SellPackageDeps {
  return {
    finance: { repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock },
    entitlements: entDeps(),
  }
}

/**
 * The kasa the money lands in (Alpha Review).
 *
 * Cash and POS need an OPEN drawer — the domain refuses otherwise (`drawer_required`), and it is
 * right to: money taken at the desk with no till open is money the day-end count can never explain.
 * Reception does not pick the drawer; the studio has one of each, and asking her to choose would be
 * asking her to get it wrong.
 */
async function drawerFor(
  ctx: Awaited<ReturnType<typeof requireTenantContext>>,
  method: PaymentMethod,
): Promise<string | null> {
  // Only cash lands in a till. A transfer and a card do not (the card terminal has its own POS
  // drawer, which this form does not offer).
  if (method !== 'cash') return null
  const drawers = await new FirestoreFinanceRepository(adminDb()).listDrawers(ctx)
  return drawers.find((d) => d.status === 'open' && d.kind === 'cash')?.id ?? null
}

// ── SELL A PACKAGE (Alpha Review, 2026-07-13) ────────────────────────────────────────────────
//
// This is THE sale. It grants the package AND records the money in the ledger — the one place the
// dashboard, the sales report, the collections report, the kasa and the cari hesap all read from.
//
// It used to write the money onto the entitlement instead, where none of those look. A package sold
// for 3.000 ₺ in cash produced a dashboard reading 0 ₺ and an empty till. That is fixed here, and it
// is fixed by making the ledger the ONE truth rather than by teaching five screens a second one.
export async function assignSubscriptionAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      productId: nonEmpty,
      validFrom: date,
      validUntil: date.nullable(),
      priceAgreedKurus: z.number().int().min(0).nullable(),
      creditOverride: z.number().int().min(0).nullable(),
      collectedKurus: z.number().int().min(0),
      method,
      note: z.string(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, p.productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }

  const drawerId = await drawerFor(ctx, p.method as PaymentMethod)

  // KK/havale farkı (PF-6): the SAME data-driven surcharge as the PAYTR flow. Cash pays the base;
  // every non-cash method (credit_card / bank_transfer) adds the studio's configured surcharge to what
  // is OWED (priceAgreed). Added once, server-side — the client sends the base price. #4/#12: the amount
  // is a setting, never a literal; 0 when unset.
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  const baseKurus = p.priceAgreedKurus ?? product.priceInKurus
  const surchargeKurus = p.method !== 'cash' ? cardSurchargeKurus(baseKurus, product.category, settings?.paymentSurcharge) : 0
  const priceAgreedKurus = baseKurus + surchargeKurus

  const grant: Grant =
    product.type === 'credit'
      ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
      : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }

  const creditOverride =
    p.creditOverride == null ? null : Math.min(product.creditCount ?? Infinity, Math.max(0, Math.trunc(p.creditOverride)))
  const saleNote = autoSaleNote(product.creditCount, creditOverride, p.note)

  const subscription = {
    memberId: p.memberId as MemberId,
    productId: product.id,
    productSnapshot: {
      productId: product.id,
      name: product.name,
      category: product.category,
      grant,
      listPrice: money(product.priceInKurus),
      // D12 — the service-level right, frozen at purchase. A later catalogue edit cannot
      // reach it; that is the point. Every NEW purchase carries it explicitly.
      serviceIds: product.serviceIds,
      // Package rules (Plus Phase 3) — frozen at purchase like the rest of the snapshot, so a later
      // catalogue edit never changes the rules a member already bought.
      cancellationAllowanceCount: product.cancellationAllowanceCount,
      dailyReservationLimit: product.dailyReservationLimit,
      activeReservationLimit: product.activeReservationLimit,
      entryAllowance: product.entryAllowance ?? null,
    },
    policyRef: { policyId: product.id, version: 1 },
    priceAgreed: money(priceAgreedKurus),
    validFrom: dayMs(p.validFrom),
    validUntil: p.validUntil ? dayMs(p.validUntil) : null,
    freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
    // Reception may LOWER the granted credits (an 8-class package sold as 3) but never RAISE them above
    // what the package defines — a 24 can't become 25. Clamped above; the sale note is auto-filled when
    // the credit is lowered so reception isn't blocked by the adjustment's note requirement (AD-39).
    creditOverride,
    // The entitlement no longer records money — the ledger does. This is passed only because the
    // shape demands it; `sellPackage` zeroes it, deliberately and in one place.
    collectedAmount: money(0),
    method: p.method as PaymentMethod,
    note: saleNote,
  } satisfies AssignSubscriptionInput

  const branchId = (ctx.branchIds[0] ?? null) as BranchId

  return observed(
    'finance.sell_package',
    ctx,
    undefined,
    { memberId: p.memberId, productId: p.productId, collectedKurus: p.collectedKurus },
    () =>
      sellPackage(sellDeps(), ctx, {
        branchId,
        subscription,
        // Selling without collecting is legal here (`balanceDue > 0`), and the dashboard is built to
        // surface it. Zero collected ⇒ no payment, not a payment of zero.
        payment:
          p.collectedKurus > 0
            ? {
                amount: money(p.collectedKurus),
                method: p.method as PaymentMethod,
                receivedAt: instant(Date.now()),
                drawerId,
                giftCardCode: null,
                note: p.note || null,
                // Reception records money at the desk (incl. migrating old members). If a kasa is open
                // it is used; if not, the cash is recorded truthfully drawerless rather than refused.
                allowNoDrawer: true,
              }
            : null,
        discountCeilingPercent: null,
      }),
  )
}

// ── SELL A PACKAGE VIA PAYMENT LINK (Sanal POS/Link consolidation, 2026-07-21) ───────────────────
//
// Reception picks "Linkle Ödeme" in the sale form. The member is KNOWN, so — per the owner's model —
// the package is granted RIGHT NOW with the full amount as debt (üye borçlu), and a PAYTR link is sent.
// When the link is paid, the callback settles it automatically as HER payment (kasa + clears the debt);
// see the attributed 'collection' branch in payment-callback.ts. `amountKurus` is the admin's final
// total (price + surcharge, editable in the form) — used verbatim, NOT re-surcharged here.
export async function createPackageLinkSaleAction(input: unknown) {
  const p = z
    .object({
      memberId: nonEmpty,
      productId: nonEmpty,
      validFrom: date,
      validUntil: date.nullable(),
      creditOverride: z.number().int().min(0).nullable(),
      note: z.string().default(''),
      amountKurus: z.number().int().min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, p.productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }
  const branchId = (ctx.branchIds[0] ?? null) as BranchId | null

  const grant: Grant =
    product.type === 'credit'
      ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
      : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }

  const creditOverride =
    p.creditOverride == null ? null : Math.min(product.creditCount ?? Infinity, Math.max(0, Math.trunc(p.creditOverride)))
  const saleNote = autoSaleNote(product.creditCount, creditOverride, p.note)

  const subscription = {
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
    priceAgreed: money(p.amountKurus),
    validFrom: dayMs(p.validFrom),
    validUntil: p.validUntil ? dayMs(p.validUntil) : null,
    freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
    creditOverride,
    collectedAmount: money(0),
    // Inert: no payment is recorded here (collectedAmount 0). The real money lands on the link callback.
    method: 'credit_card' as PaymentMethod,
    note: saleNote,
  } satisfies AssignSubscriptionInput

  // 1. Grant now with full debt. If this fails nothing else happens.
  const sold = await observed(
    'finance.sell_package',
    ctx,
    undefined,
    { memberId: p.memberId, productId: p.productId, collectedKurus: 0 },
    () => sellPackage(sellDeps(), ctx, { branchId: branchId as BranchId, subscription, payment: null, discountCeilingPercent: null }),
  )
  if (!sold.ok) return { ok: false as const, error: sold.error }

  // 2. Create the attributed collection link. The grant is already committed; if the link fails the
  //    member is simply borçlu (reception can collect from Cari Hesap or retry) — a valid state.
  return createMemberCollectionCheckout(ctx, {
    memberId: p.memberId as MemberId,
    amountKurus: p.amountKurus,
    flow: 'link',
    branchId: branchId as string | null,
    note: `Paket: ${product.name}`,
    itemName: product.name,
  })
}

// ── Edit an existing subscription (dates / price / payment), reason mandatory. ──
export async function amendSubscriptionAction(input: unknown) {
  const p = z
    .object({
      entitlementId: nonEmpty,
      // Reason is OPTIONAL now (owner: migration speed — don't gate reception with mandatory notes).
      // The correction is still an append-only compensating event; when reception leaves it blank we
      // stamp a neutral default so the audit event always carries SOMETHING, never an empty string.
      reason: z.string().optional(),
      validFrom: date.optional(),
      validUntil: date.optional(),
      priceAgreedKurus: z.number().int().min(0).optional(),
      // NO payment. Editing a package changes what was AGREED; it never records money. Money is taken
      // in the cari hesap, where it lands in the ledger and in the till (Alpha Review).
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const patch: AmendPatch = {
    ...(p.validFrom ? { validFrom: instant(dayMs(p.validFrom)) } : {}),
    ...(p.validUntil ? { validUntil: instant(dayMs(p.validUntil)) } : {}),
    ...(p.priceAgreedKurus !== undefined ? { priceAgreed: money(p.priceAgreedKurus) } : {}),
  }
  return amendEntitlement(entDeps(), ctx, {
    entitlementId: p.entitlementId as EntitlementId,
    patch,
    reason: p.reason?.trim() || 'Düzenleme',
  })
}

// Credit edit reuses the existing adjustment mechanism (no new arithmetic). The UI
// sends a signed delta + a note; the reason is a correction.
export async function adjustSubscriptionCreditsAction(input: unknown) {
  // Note is OPTIONAL now (owner: don't gate reception). The adjustment is still an append-only event
  // that records who moved what; a blank note falls back to a neutral default so it is never empty.
  const p = z.object({ entitlementId: nonEmpty, delta: z.number().int(), note: z.string().optional() }).parse(input)
  const ctx = await requireTenantContext(OPS)
  // A hand-moved credit is the most disputable number in the product: it is the one a member can
  // notice, and the one no arithmetic re-derives. The `note` is NOT logged — it is free text, and
  // free text is where PII hides — but the delta and the entitlement are, so the log can always
  // answer *who moved what, when*, alongside the event that made it permanent.
  return observed(
    'entitlement.adjust_credits',
    ctx,
    undefined,
    { entitlementId: p.entitlementId, delta: p.delta },
    () =>
      adjustCredits(entDeps(), ctx, {
        entitlementId: p.entitlementId as EntitlementId,
        delta: p.delta,
        reason: 'correction',
        note: p.note?.trim() || 'Düzeltme',
      }),
  )
}

export async function reactivateSubscriptionAction(input: unknown) {
  const p = z.object({ entitlementId: nonEmpty, reason: z.string().optional() }).parse(input)
  return reactivateEntitlement(entDeps(), await requireTenantContext(OPS), {
    entitlementId: p.entitlementId as EntitlementId,
    reason: p.reason?.trim() || 'Yeniden aktifleştirme',
  })
}

export async function cancelSubscriptionAction(input: unknown) {
  const p = z.object({ entitlementId: nonEmpty, reason: z.string().optional() }).parse(input)
  return cancelEntitlement(entDeps(), await requireTenantContext(CANCEL), {
    entitlementId: p.entitlementId as EntitlementId,
    reason: p.reason?.trim() || 'İptal',
    refundPaymentId: null,
  })
}

// ── Reads ──
export interface SubscriptionView {
  readonly id: string
  readonly productName: string
  readonly category: string
  readonly status: string
  readonly type: 'credit' | 'period'
  readonly validFrom: number
  readonly validUntil: number
  readonly creditsGranted: number | null
  readonly creditsAvailable: number | null
  readonly priceAgreedKurus: number
  readonly paidKurus: number
  readonly balanceDueKurus: number
  readonly method: string | null
  readonly note: string | null
  // ── Freeze (v1.27 S3) ──
  /** Her budget, as sold. 0 or null ⇒ this product has no freeze (Pilates). */
  readonly freezeEntitledDays: number | null
  /** What she has left to spend. The screen shows it; the nightly sweep enforces it. */
  readonly freezeDaysRemaining: number | null
  /** LocalDate the current freeze started, or null. */
  readonly frozenSince: string | null
}

export async function listMemberSubscriptionsAction(input: unknown): Promise<readonly SubscriptionView[]> {
  const p = z.object({ memberId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  // The money comes from the LEDGER, not from the entitlement (Alpha Review). The entitlement records
  // what was AGREED; the ledger records what was PAID. Asking the entitlement "has she paid?" is how
  // the packages screen came to disagree with the cari hesap on the very next tab.
  const [rows, ledger] = await Promise.all([
    new FirestoreEntitlementRepository(adminDb()).listByMember(ctx, p.memberId as MemberId),
    moneyByEntitlement(
      { repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock },
      ctx,
      p.memberId as MemberId,
    ),
  ])
  return rows
    .map((e) => ({
      id: e.id,
      productName: e.productSnapshot.name,
      category: e.productSnapshot.category,
      status: e.status,
      type: (e.credits ? 'credit' : 'period') as 'credit' | 'period',
      validFrom: e.validFrom,
      validUntil: e.validUntil,
      creditsGranted: e.credits ? e.credits.granted : null,
      creditsAvailable: e.credits ? (e.status === 'active' ? available(e.credits) : 0) : null,
      priceAgreedKurus: e.priceAgreed.amount,
      paidKurus: ledger.get(e.id as string)?.paid.amount ?? 0,
      balanceDueKurus: ledger.get(e.id as string)?.due.amount ?? 0,
      method: ledger.get(e.id as string)?.method ?? null,
      note: null,
      freezeEntitledDays: e.freeze?.entitledDays ?? null,
      freezeDaysRemaining: e.freeze ? freezeDaysRemaining(e.freeze) : null,
      frozenSince: e.freeze?.activeFrom ?? null,
    }))
    .sort((a, b) => b.validFrom - a.validFrom)
}

// ── FREEZE (v1.27 S3 · owner, 2026-07-13 · closes DEBT-009) ──────────────────────────────────

/**
 * Freeze a membership.
 *
 * The UPCOMING-RESERVATION check happens here, because the reservations live in another aggregate —
 * and the answer is a **refusal**, never a fix. Cancelling her class for her would move a credit she
 * never asked us to move, and she would learn about it from a ledger rather than from us (owner:
 * *"Hiçbir kredi veya rezervasyon otomatik değiştirilmesin"*).
 */
export async function freezeSubscriptionAction(input: unknown) {
  const p = z.object({ entitlementId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)

  const ent = await new FirestoreEntitlementRepository(adminDb()).getEntitlement(
    ctx,
    p.entitlementId as EntitlementId,
  )
  if (!ent) throw new Error(`Entitlement not found: ${p.entitlementId}`)

  const now = Date.now()
  const upcoming = await new FirestoreReservationRepository(adminDb()).listByMember(
    ctx,
    ent.memberId,
  )
  const hasUpcomingReservation = upcoming.some(
    (r) => r.status === 'booked' && (r.sessionStartsAt as number) > now,
  )

  const today = localDateAt(instant(now), DEFAULT_STUDIO_CONFIG.utcOffsetMinutes) as string

  return observed(
    'entitlement.freeze',
    ctx,
    undefined,
    { entitlementId: p.entitlementId },
    () =>
      freezeEntitlement(entDeps(), ctx, {
        entitlementId: p.entitlementId as EntitlementId,
        from: today,
        hasUpcomingReservation,
      }),
  )
}

export async function unfreezeSubscriptionAction(input: unknown) {
  const p = z.object({ entitlementId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const today = localDateAt(instant(Date.now()), DEFAULT_STUDIO_CONFIG.utcOffsetMinutes) as string

  return observed(
    'entitlement.unfreeze',
    ctx,
    undefined,
    { entitlementId: p.entitlementId },
    () =>
      unfreezeEntitlement(entDeps(), ctx, {
        entitlementId: p.entitlementId as EntitlementId,
        to: today,
        auto: false, // a human asked for this, and the audit must say so
      }),
  )
}

export interface TimelineRow {
  readonly type: string
  readonly occurredAt: number
  readonly actorType: string
  readonly payload: Record<string, unknown>
}

export async function getSubscriptionTimelineAction(input: unknown): Promise<readonly TimelineRow[]> {
  const p = z.object({ entitlementId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const rows = await new FirestoreEntitlementRepository(adminDb()).listEntitlementEvents(ctx, p.entitlementId as EntitlementId)
  return rows.map((r) => ({ type: r.type, occurredAt: r.occurredAt, actorType: r.actorType, payload: r.payload }))
}
