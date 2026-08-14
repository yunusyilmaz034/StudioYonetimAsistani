'use server'

import {
  correctDiscount,
  isSuspectedDuplicate,
  DEFAULT_STUDIO_CONFIG,
  FirestoreReservationRepository,
  freezeDaysRemaining,
  freezeEntitlement,
  localDateAt,
  unfreezeEntitlement,
  adjustCredits,
  amendEntitlement,
  assignSubscription,
  available,
  cancelEntitlement,
  cardSurchargeKurus,
  entriesUsed,
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
  discountSale
} from '@studio/core'
import { z } from 'zod'

import { autoSaleNote } from '@/lib/sale-credit-note'

import { requireTenantContext } from '../auth'
import { observed } from '../log'
import { adminDb } from '../firebase-admin'
import { createMemberCollectionCheckout } from './payments'
import { grantBundleComponents } from '../sell-bundle'

// Selling (assign) is owner + receptionist + platform_admin (Doc 13). Cancelling is
// owner + platform_admin. Reads are gated the same as selling.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const CANCEL = ['owner', 'platform_admin'] as const
// Going PAST the studio's own terms is the owner's call, not the desk's (owner, 2026-07-31). Same
// set as CANCEL and deliberately its own name: these two are allowed to drift apart, and a shared
// constant is how a permission table silently becomes a different table.
const INITIATIVE = ['owner', 'platform_admin'] as const
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
      // İNDİRİM (owner, 2026-08-06). An amount in kuruş, never a percentage — the same 15% is a
      // different number the day a rounding rule moves; the kuruş it was worth on the day of sale is
      // not (I-34). `reason` is optional at the DESK by the owner's decision, so it defaults to
      // `gift`; `manual` is the one reason the domain requires a note for (I-36), and the form only
      // offers it together with that note.
      discountKurus: z.number().int().min(0).nullable().optional(),
      discountReason: z.enum(['campaign', 'coupon', 'referral', 'gift', 'manual']).optional(),
      discountNote: z.string().optional(),
      creditOverride: z.number().int().min(0).nullable(),
      // Hibrit demet: per-component credit/entry counts the admin edited at the desk. Index-aligned to
      // the product's components; a null entry keeps that component's catalogue default.
      componentOverrides: z.array(z.number().int().min(0).nullable()).nullable().optional(),
      collectedKurus: z.number().int().min(0),
      method,
      note: z.string(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, p.productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }

  // ── The second press is not a second sale (owner, 2026-07-29) ─────────────────────────────
  //
  // When the panel feels slow — or answers with an error reception cannot act on — she presses
  // again, and every press that reaches here is a complete sale. The member ends up holding two
  // identical packages and a balance nobody can explain without reading the log.
  //
  // Checked on the SERVER because that is the only place that sees every attempt: the client
  // already disables the button while a sale is in flight, and it did not help — a failed call
  // re-enables it, and pressing again is exactly what we ask her to do.
  //
  // Refused rather than swallowed: silently ignoring it would be idempotency, and idempotency needs
  // a key the client repeats, not a guess based on timing. The reasoning is in the domain file.
  //
  // `listByMember` is a single-field query — no composite index, so nothing here can pass locally
  // and then fail in production for want of one.
  const existing = await entDeps().repo.listByMember(ctx, p.memberId as MemberId)
  if (isSuspectedDuplicate(existing, product.id, systemClock.now())) {
    return { ok: false as const, error: { code: 'duplicate_sale_suspected' as const } }
  }

  // ── WHO MAY DISCOUNT (owner, 2026-08-06: "indirimi sadece owner ve Işıl verebilsin") ──────
  //
  // Enforced in the Server Action, the same place the catalogue's write rule lives (AD-46), because
  // this is an AUTHORISATION question rather than a domain one: the ledger's job is to make the
  // arithmetic true, not to know the studio's staffing. Reception sells at the list price; changing
  // what a package costs is the owner's decision, and there is exactly one owner account.
  //
  // REFUSED, never silently dropped. Ignoring the field would record the sale at full price with less
  // money against it — a debt the member does not owe, which is precisely the bug this feature exists
  // to prevent.
  const discountKurus = p.discountKurus ?? 0
  if (discountKurus > 0 && ctx.role !== 'owner' && ctx.actor.type !== 'platform_admin') {
    return { ok: false as const, error: { code: 'staff_admin_required' as const } }
  }
  const discounts =
    discountKurus > 0
      ? [
          {
            reason: p.discountReason ?? 'gift',
            amount: money(discountKurus),
            note: p.discountNote?.trim() ?? '',
            couponCode: null,
            referredByMemberId: null,
            grantedBy: ctx.actor,
          },
        ]
      : []

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

  // ── HİBRİT DEMET (v1.30) — a bundle grants one entitlement PER COMPONENT, each in its OWN category so
  //    the wall (I-9.7) stays intact (a pilates credit never opens fitness). The FIRST component's sale
  //    carries the full price + the payment; the rest are granted at 0 (included in the bundle). N sales,
  //    one price. A failing later component stops the loop and returns the error — reception retries. ──
  if (product.components && product.components.length > 0) {
    const components = product.components
    let firstOk: Awaited<ReturnType<typeof sellPackage>> | null = null
    for (let i = 0; i < components.length; i++) {
      const c = components[i]!
      const isPrimary = i === 0
      // The admin may edit each component's count at the desk (componentOverrides); null keeps the
      // catalogue default. A credit component overrides its credits; an entry component its allowance.
      const override = p.componentOverrides?.[i] ?? null
      const isCredit = c.creditCount != null
      const cGrant: Grant = isCredit
        ? { kind: 'credits', credits: override ?? c.creditCount ?? 0, validForDays: product.durationDays }
        : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }
      const cEntry = isCredit ? c.entryAllowance : override ?? c.entryAllowance
      const cSub = {
        memberId: p.memberId as MemberId,
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
        // A hibrit'in KK farkı admin inisiyatifinde ve DENGESİZLİK YARATMAZ (owner): the agreed price is
        // max(bundle base, what was collected). Applied surcharge (collected = base+%) → balance 0; waived
        // (collected = base) → balance 0; on account (collected 0) → owes the BASE only, never the surcharge.
        priceAgreed: money(isPrimary ? Math.max(product.priceInKurus, p.collectedKurus) : 0),
        validFrom: dayMs(p.validFrom),
        validUntil: p.validUntil ? dayMs(p.validUntil) : null,
        freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
        creditOverride: null,
        collectedAmount: money(0),
        method: p.method as PaymentMethod,
        note: saleNote,
      } satisfies AssignSubscriptionInput
      // ONE sale, N entitlements. Only the PRIMARY component carries the price + payment, so it is the
      // only real SALE — a zero-price sale is (rightly) refused by the ledger (gross ≤ 0), which is what
      // silently dropped every non-primary component before. The rest are pure entitlement grants.
      if (isPrimary) {
        const r = await observed(
          'finance.sell_package',
          ctx,
          undefined,
          { memberId: p.memberId, productId: p.productId, collectedKurus: p.collectedKurus },
          () =>
            sellPackage(sellDeps(), ctx, {
              branchId,
              subscription: cSub,
              payment:
                p.collectedKurus > 0
                  ? {
                      amount: money(p.collectedKurus),
                      method: p.method as PaymentMethod,
                      receivedAt: instant(Date.now()),
                      drawerId,
                      giftCardCode: null,
                      note: p.note || null,
                      allowNoDrawer: true,
                    }
                  : null,
              discounts,
              discountCeilingPercent: null,
            }),
        )
        if (!r.ok) return r
        firstOk = r
      } else {
        const r = await assignSubscription(entDeps(), ctx, cSub)
        if (!r.ok) return r
      }
    }
    return firstOk!
  }

  return observed(
    'finance.sell_package',
    ctx,
    undefined,
    { memberId: p.memberId, productId: p.productId, collectedKurus: p.collectedKurus },
    () =>
      sellPackage(sellDeps(), ctx, {
        branchId,
        subscription,
        discounts,
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
      componentOverrides: z.array(z.number().int().min(0).nullable()).nullable().optional(),
      note: z.string().default(''),
      amountKurus: z.number().int().min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const product = await new FirestoreCatalogRepository(adminDb()).getProduct(ctx, p.productId as ProductId)
  if (!product) return { ok: false as const, error: { code: 'no_bookable_entitlement' as const } }
  const branchId = (ctx.branchIds[0] ?? null) as BranchId | null

  // Hibrit demet: grant one entitlement PER COMPONENT now (full debt on the primary = amountKurus); the
  // link settles that debt on payment → balance 0. Same multi-grant as the manual/pos paths.
  if (product.components && product.components.length > 0) {
    const bundle = await observed('finance.sell_package', ctx, undefined, { memberId: p.memberId, productId: p.productId, collectedKurus: 0 }, () =>
      grantBundleComponents(sellDeps(), ctx, {
        product,
        memberId: p.memberId,
        branchId: branchId as BranchId,
        primaryPriceKurus: p.amountKurus,
        componentOverrides: p.componentOverrides ?? null,
        validFromMs: dayMs(p.validFrom),
        validUntilMs: p.validUntil ? dayMs(p.validUntil) : null,
        method: 'credit_card' as PaymentMethod,
        note: autoSaleNote(null, null, p.note),
        payment: null,
      }),
    )
    if (!bundle.ok) return { ok: false as const, error: bundle.error }
    return createMemberCollectionCheckout(ctx, {
      memberId: p.memberId as MemberId,
      amountKurus: p.amountKurus,
      flow: 'link',
      branchId: branchId as string | null,
      note: `Paket: ${product.name}`,
      itemName: product.name,
      // The primary component carries the whole bundle's debt, so it is the sale this link settles.
      saleId: bundle.value.saleId,
    })
  }

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
    saleId: sold.value.saleId,
  })
}

// ── Edit an existing subscription (dates / price / payment), reason mandatory. ──
/**
 * Forgive what is still owed on a sale, as a DISCOUNT (owner, 2026-08-07).
 *
 * The sale-time discount could not reach the commonest case: reception sells at list, takes what the
 * member brought, and the rest is agreed away afterwards. The only lever until now was to edit the
 * agreed price down, which closes the balance and loses both facts — what the package costs, and
 * that ₺800 was given away.
 *
 * Owner-only, like the sale-time one and for the same reason (OR-32): it is an authorisation
 * question, not a domain one, and refusing it is safer than dropping it — a dropped discount leaves
 * the debt exactly where it was.
 */
export async function discountSaleAction(input: unknown) {
  const p = z
    .object({
      saleId: nonEmpty,
      amountKurus: z.number().int().min(1),
      reason: z.enum(['campaign', 'coupon', 'referral', 'gift', 'manual']).default('gift'),
      note: z.string().trim().max(500).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  if (ctx.role !== 'owner' && ctx.actor.type !== 'platform_admin') {
    return { ok: false as const, error: { code: 'staff_admin_required' as const } }
  }
  return discountSale(sellDeps().finance, ctx, {
    saleId: p.saleId,
    discount: {
      reason: p.reason,
      amount: money(p.amountKurus),
      note: p.note ?? '',
      couponCode: null,
      referredByMemberId: null,
      grantedBy: ctx.actor,
    },
  })
}

/**
 * Take back part of a discount entered wrongly (owner, 2026-08-11).
 *
 * Owner-only, exactly like granting one (OR-32): reception collects, the owner decides what the
 * studio gives away — and what it takes back. A note is required whatever the reason, which is
 * stricter than the grant path, because "why was this corrected" has no default answer.
 */
export async function correctDiscountAction(input: unknown) {
  const p = z
    .object({
      saleId: nonEmpty,
      amountKurus: z.number().int().min(1),
      reason: z.enum(['wrong_amount', 'wrong_member', 'duplicate', 'other']),
      note: z.string().trim().min(1).max(500),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)
  if (ctx.role !== 'owner' && ctx.actor.type !== 'platform_admin') {
    return { ok: false as const, error: { code: 'staff_admin_required' as const } }
  }
  return correctDiscount(sellDeps().finance, ctx, {
    saleId: p.saleId,
    correction: {
      reason: p.reason,
      amount: money(p.amountKurus),
      note: p.note,
      correctedBy: ctx.actor,
    },
  })
}

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
      // Fitness serbest-giriş grant (the cap) — re-granted like a credit count is adjusted. `null` ⇒
      // unlimited. Only meaningful on a period package that carries an entry allowance.
      entryAllowance: z.number().int().min(0).nullable().optional(),
      // NO payment. Editing a package changes what was AGREED; it never records money. Money is taken
      // in the cari hesap, where it lands in the ledger and in the till (Alpha Review).
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const patch: AmendPatch = {
    ...(p.validFrom ? { validFrom: instant(dayMs(p.validFrom)) } : {}),
    ...(p.validUntil ? { validUntil: instant(dayMs(p.validUntil)) } : {}),
    ...(p.priceAgreedKurus !== undefined ? { priceAgreed: money(p.priceAgreedKurus) } : {}),
    ...(p.entryAllowance !== undefined ? { entryAllowance: p.entryAllowance } : {}),
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
  readonly productId: string
  // TRUE when this entitlement is a component of a HYBRID (bundle) product — its siblings (same
  // productId) are the demet's other components, edited together in one screen.
  readonly isBundle: boolean
  readonly productName: string
  readonly category: string
  readonly status: string
  readonly type: 'credit' | 'period'
  readonly validFrom: number
  readonly validUntil: number
  readonly creditsGranted: number | null
  readonly creditsAvailable: number | null
  // Fitness serbest-giriş cap: the grant (allowance) and net used, so the desk can edit "giriş hakkı"
  // the way it edits credits. `null` allowance ⇒ this package has no entry cap (not a fitness giriş).
  readonly entryAllowance: number | null
  readonly entriesUsed: number
  readonly priceAgreedKurus: number
  readonly paidKurus: number
  /**
   * What was given away on this package's sale. `priceAgreedKurus` is the price BEFORE it and
   * `paidKurus`/`balanceDueKurus` are after — so without this the three numbers do not reconcile
   * on screen, and a settled discount reads as a missing debt.
   */
  readonly discountKurus: number
  readonly balanceDueKurus: number
  /** The sale that granted this package — what a post-sale discount is applied to. */
  readonly saleId: string | null
  readonly method: string | null
  readonly note: string | null
  // ── Freeze (v1.27 S3) ──
  /** Her budget, as sold. 0 or null ⇒ this product has no freeze (Pilates). */
  readonly freezeEntitledDays: number | null
  /** What she has left to spend. The screen shows it; the nightly sweep enforces it. */
  readonly freezeDaysRemaining: number | null
  /** LocalDate the current freeze started, or null. */
  readonly frozenSince: string | null
  /**
   * LocalDate the running freeze ENDS on — what the sweep will actually do, not what the budget
   * implies. They are the same in the ordinary case and differ after an initiative (2026-07-31):
   * a fortnight approved on a seven-day package resumes on day fourteen, and a screen that read the
   * budget instead would promise day seven to the one person who needs to know.
   */
  readonly freezeEndsOn: string | null
}

export async function listMemberSubscriptionsAction(input: unknown): Promise<readonly SubscriptionView[]> {
  const p = z.object({ memberId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  // The money comes from the LEDGER, not from the entitlement (Alpha Review). The entitlement records
  // what was AGREED; the ledger records what was PAID. Asking the entitlement "has she paid?" is how
  // the packages screen came to disagree with the cari hesap on the very next tab.
  const [rows, ledger, products] = await Promise.all([
    new FirestoreEntitlementRepository(adminDb()).listByMember(ctx, p.memberId as MemberId),
    moneyByEntitlement(
      { repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock },
      ctx,
      p.memberId as MemberId,
    ),
    new FirestoreCatalogRepository(adminDb()).listProducts(ctx),
  ])
  // The catalogue decides "is this a hybrid?": a product with components is a demet (AD-41, data not
  // name). Every entitlement it granted is a bundle component; its siblings share the productId.
  const bundleProductIds = new Set(products.filter((pr) => (pr.components?.length ?? 0) > 0).map((pr) => pr.id as string))
  return rows
    .map((e) => ({
      id: e.id,
      productId: e.productSnapshot.productId as string,
      isBundle: bundleProductIds.has(e.productSnapshot.productId as string),
      productName: e.productSnapshot.name,
      category: e.productSnapshot.category,
      status: e.status,
      type: (e.credits ? 'credit' : 'period') as 'credit' | 'period',
      validFrom: e.validFrom,
      validUntil: e.validUntil,
      creditsGranted: e.credits ? e.credits.granted : null,
      creditsAvailable: e.credits ? (e.status === 'active' ? available(e.credits) : 0) : null,
      entryAllowance: e.productSnapshot.entryAllowance ?? null,
      entriesUsed: entriesUsed(e.entryLedger),
      priceAgreedKurus: e.priceAgreed.amount,
      saleId: ledger.get(e.id as string)?.saleId ?? null,
      paidKurus: ledger.get(e.id as string)?.paid.amount ?? 0,
      discountKurus: ledger.get(e.id as string)?.discount.amount ?? 0,
      balanceDueKurus: ledger.get(e.id as string)?.due.amount ?? 0,
      method: ledger.get(e.id as string)?.method ?? null,
      note: null,
      freezeEntitledDays: e.freeze?.entitledDays ?? null,
      freezeDaysRemaining: e.freeze ? freezeDaysRemaining(e.freeze) : null,
      frozenSince: e.freeze?.activeFrom ?? null,
      freezeEndsOn: e.freeze?.activeFrom ? e.freeze.plannedUntil ?? null : null,
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
  // The plan is required (owner, 2026-07-28). A freeze whose end nobody can state is a freeze
  // nobody — member or desk — can plan around, which is how it fired on a single click and stopped
  // a paid membership for an unknown length of time.
  const p = z
    .object({
      entitlementId: nonEmpty,
      plannedDays: z.number().int().min(1).max(365),
      reason: z.enum(['tatil', 'saglik', 'is', 'diger']),
      // Free text stays OUT of the event and lives on the entitlement, where an erasure can reach
      // it (#6). Bounded, because an unbounded note is an unbounded place to hide things.
      note: z.string().trim().max(300).nullable().optional(),
      // THE INITIATIVE (owner, 2026-07-31): *"admin yine de istediği kadar dondurabilsin, bazı
      // üyelere inisiyatif kullanabiliyoruz."* Absent/false ⇒ the domain refuses anything past her
      // allowance exactly as it always did. It is an opt-in flag rather than a looser rule so that
      // a caller which does not know about initiative cannot use it by accident.
      override: z.boolean().optional(),
    })
    .parse(input)
  // OWNER-ONLY, and the guard is chosen by what is being asked for. Reception may freeze within the
  // terms the studio sells; only the owner may exceed them. The domain would still write the freeze
  // for whoever asked — authorization is this door's job, not the decision function's (AD-35/AD-46).
  const ctx = await requireTenantContext(p.override ? INITIATIVE : OPS)

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
    { entitlementId: p.entitlementId, override: p.override === true },
    () =>
      freezeEntitlement(entDeps(), ctx, {
        entitlementId: p.entitlementId as EntitlementId,
        from: today,
        hasUpcomingReservation,
        plan: {
          plannedDays: p.plannedDays,
          reason: p.reason,
          note: p.note ?? null,
          override: p.override === true,
        },
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
