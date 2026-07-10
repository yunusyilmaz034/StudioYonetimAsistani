import type { Instant, Money, PaymentId, ProductId, ReservationId } from '../../shared'
import type { AdjustmentReason, Grant } from './domain/types'

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
}
