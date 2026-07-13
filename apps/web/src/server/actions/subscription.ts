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
  assignSubscription,
  available,
  cancelEntitlement,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  instant,
  money,
  reactivateEntitlement,
  systemClock,
  type AmendPatch,
  type EntitlementId,
  type EntitlementsDeps,
  type Grant,
  type ManualPayment,
  type MemberId,
  type PaymentMethod,
  type ProductId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { observed } from '../log'
import { adminDb } from '../firebase-admin'

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

// ── Assign a package to a member (atomic: purchase + optional credit override +
//    optional manual payment). ──
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

  const grant: Grant =
    product.type === 'credit'
      ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
      : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }

  return assignSubscription(entDeps(), ctx, {
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
    },
    policyRef: { policyId: product.id, version: 1 },
    priceAgreed: money(p.priceAgreedKurus ?? product.priceInKurus),
    validFrom: dayMs(p.validFrom),
    validUntil: p.validUntil ? dayMs(p.validUntil) : null,
    freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
    creditOverride: p.creditOverride,
    collectedAmount: money(p.collectedKurus),
    method: p.method as PaymentMethod,
    note: p.note,
  })
}

// ── Edit an existing subscription (dates / price / payment), reason mandatory. ──
export async function amendSubscriptionAction(input: unknown) {
  const p = z
    .object({
      entitlementId: nonEmpty,
      reason: nonEmpty,
      validFrom: date.optional(),
      validUntil: date.optional(),
      priceAgreedKurus: z.number().int().min(0).optional(),
      payment: z
        .object({ collectedKurus: z.number().int().min(0), method, note: z.string() })
        .optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const patch: AmendPatch = {
    ...(p.validFrom ? { validFrom: instant(dayMs(p.validFrom)) } : {}),
    ...(p.validUntil ? { validUntil: instant(dayMs(p.validUntil)) } : {}),
    ...(p.priceAgreedKurus !== undefined ? { priceAgreed: money(p.priceAgreedKurus) } : {}),
    ...(p.payment
      ? {
          manualPayment:
            p.payment.collectedKurus > 0
              ? ({
                  collectedAmount: money(p.payment.collectedKurus),
                  method: p.payment.method as PaymentMethod,
                  note: p.payment.note.trim() || null,
                  recordedAt: systemClock.now(),
                } satisfies ManualPayment)
              : null,
        }
      : {}),
  }
  return amendEntitlement(entDeps(), ctx, { entitlementId: p.entitlementId as EntitlementId, patch, reason: p.reason })
}

// Credit edit reuses the existing adjustment mechanism (no new arithmetic). The UI
// sends a signed delta + a note; the reason is a correction.
export async function adjustSubscriptionCreditsAction(input: unknown) {
  const p = z.object({ entitlementId: nonEmpty, delta: z.number().int(), note: nonEmpty }).parse(input)
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
        note: p.note,
      }),
  )
}

export async function reactivateSubscriptionAction(input: unknown) {
  const p = z.object({ entitlementId: nonEmpty, reason: nonEmpty }).parse(input)
  return reactivateEntitlement(entDeps(), await requireTenantContext(OPS), {
    entitlementId: p.entitlementId as EntitlementId,
    reason: p.reason,
  })
}

export async function cancelSubscriptionAction(input: unknown) {
  const p = z.object({ entitlementId: nonEmpty, reason: nonEmpty }).parse(input)
  return cancelEntitlement(entDeps(), await requireTenantContext(CANCEL), {
    entitlementId: p.entitlementId as EntitlementId,
    reason: p.reason,
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
  const rows = await new FirestoreEntitlementRepository(adminDb()).listByMember(ctx, p.memberId as MemberId)
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
      creditsAvailable: e.credits ? available(e.credits) : null,
      priceAgreedKurus: e.priceAgreed.amount,
      paidKurus: e.paidTotal.amount,
      balanceDueKurus: e.priceAgreed.amount - e.paidTotal.amount,
      method: e.manualPayment ? e.manualPayment.method : null,
      note: e.manualPayment ? e.manualPayment.note : null,
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
