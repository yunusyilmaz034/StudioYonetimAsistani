import type { Instant, Money, PaymentId, ProductId, ReservationId } from '../../shared'
import type { AdjustmentReason, Grant, PaymentMethod } from './domain/types'

// The credit ledger's events (Doc 4 §"Entitlement"). No PII (I-13): identity lives
// in /members, behaviour lives here. Every credit-affecting event carries the
// post-state number it changed (creditsAvailableAfter, AD-19) and the policyVersion
// it was decided under (I-12) — the latter on the envelope's policyRef.
//
// There is NO `entitlement.credit_revoked` event (AD-43): an admin take-back is
// `entitlement.adjusted` with a negative delta. `credit_restored` survives only for
// the reservation-driven correction, which always carries a reservationId.

export const ENTITLEMENT_PURCHASED = 'entitlement.purchased'
export const ENTITLEMENT_CREDIT_HELD = 'entitlement.credit_held'
export const ENTITLEMENT_CREDIT_RELEASED = 'entitlement.credit_released'
export const ENTITLEMENT_CREDIT_CONSUMED = 'entitlement.credit_consumed'
export const ENTITLEMENT_CREDIT_RESTORED = 'entitlement.credit_restored'
export const ENTITLEMENT_ADJUSTED = 'entitlement.adjusted'
export const ENTITLEMENT_EXHAUSTED = 'entitlement.exhausted'
export const ENTITLEMENT_EXPIRED = 'entitlement.expired'
export const ENTITLEMENT_CANCELLED = 'entitlement.cancelled'
// v1.14 — manual subscription assignment / edit. `payment_recorded` is the manual
// collection (the payments seam). `amended` is the generic field edit (dates, price,
// payment info) with before/after. `reactivated` is the inverse of `cancelled`.
export const ENTITLEMENT_PAYMENT_RECORDED = 'entitlement.payment_recorded'
export const ENTITLEMENT_AMENDED = 'entitlement.amended'
export const ENTITLEMENT_REACTIVATED = 'entitlement.reactivated'

// v1.22 (D21/D22) — the studio owed her TIME back: a closure, or a bulk grant of days.
//
// Deliberately NOT `entitlement.amended`. An amendment is "a human edited this subscription";
// an extension is "the studio was closed and owed her days". They will be counted differently —
// and once they are the same event, they can never be separated again.
export const ENTITLEMENT_EXTENDED = 'entitlement.extended'

export type EntitlementPurchasedPayload = {
  readonly productId: ProductId
  readonly grant: Grant
  readonly priceAgreed: Money
  readonly listPrice: Money
  readonly validFrom: Instant
  readonly validUntil: Instant
}

export type CreditHeldPayload = {
  readonly reservationId: ReservationId
  readonly creditsAvailableAfter: number
}
export type CreditMovedPayload = {
  readonly reservationId: ReservationId
  readonly reason: string
  readonly creditsAvailableAfter: number
}

export type EntitlementAdjustedPayload = {
  readonly delta: number
  readonly reason: AdjustmentReason
  readonly note: string
  readonly creditsAvailableAfter: number
}

export type EntitlementExhaustedPayload = Record<string, never>

export type EntitlementExpiredPayload = {
  readonly grantKind: Grant['kind']
  readonly creditsExpired: number
}

export type EntitlementCancelledPayload = {
  readonly reason: string
  readonly refundPaymentId: PaymentId | null
  // Additive (v1.23) — what the reversed sale was worth, so the dashboard's revenue can go net
  // without the projector ever reading a state document. Absent on cancellations written earlier.
  readonly priceAgreed?: Money
  readonly productId?: ProductId
}

export type EntitlementPaymentRecordedPayload = {
  readonly collectedAmount: Money
  readonly method: PaymentMethod
  readonly note: string | null
  readonly priceAgreed: Money
  readonly balanceDue: Money
}

// A generic amend: the changed field names plus each field's before/after value, and
// a mandatory reason (AD-22). No PII (I-13): entitlements carry no identity.
export type EntitlementAmendedPayload = {
  readonly changedFields: readonly string[]
  readonly changes: Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>
  readonly reason: string
}

export type EntitlementExtendedPayload = {
  readonly days: number
  readonly fromValidUntil: Instant
  readonly toValidUntil: Instant
  readonly reason: string
  readonly operationId: string | null // the closure / bulk operation this belonged to
}

export type EntitlementReactivatedPayload = {
  readonly reason: string
}
