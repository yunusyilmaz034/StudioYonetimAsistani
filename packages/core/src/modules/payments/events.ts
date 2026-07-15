import type { Instant, Money } from '../../shared'
import type { PaymentFlow, PaymentProviderId, PaymentPurpose, PaymentStatus } from './domain/types'

// Payment-intent events. No PII, no card data, no secret (I-13). They record the DECISION and the
// state transitions of a payment attempt — the amount, the provider reference, the status — so the
// whole lifecycle is rebuildable from the log and a callback can never be replayed into a second
// grant. Money events are never mutated; a correction is a compensating event (#9).

export const PAYMENT_INTENT_CREATED = 'payment_intent.created'
export const PAYMENT_INTENT_SESSION_CREATED = 'payment_intent.session_created' // provider token/link obtained
export const PAYMENT_INTENT_SUCCEEDED = 'payment_intent.succeeded' // callback confirmed
export const PAYMENT_INTENT_FAILED = 'payment_intent.failed'
export const PAYMENT_INTENT_EXPIRED = 'payment_intent.expired'
export const PAYMENT_INTENT_CANCELLED = 'payment_intent.cancelled'
export const PAYMENT_INTENT_REFUND_REQUESTED = 'payment_intent.refund_requested'
export const PAYMENT_INTENT_REFUNDED = 'payment_intent.refunded'
export const PAYMENT_INTENT_FLAGGED = 'payment_intent.flagged' // moved to manual_review by reconciliation

export type PaymentIntentCreatedPayload = {
  readonly saleId: string
  readonly purpose: PaymentPurpose
  readonly provider: PaymentProviderId
  readonly flow: PaymentFlow
  readonly providerRef: string
  readonly amount: Money
}

export type PaymentIntentSessionCreatedPayload = {
  readonly providerRef: string
  readonly hasRedirect: boolean // the URL/token is PII-free but a bearer link — kept off the event
}

export type PaymentIntentSucceededPayload = {
  readonly providerRef: string
  readonly paidAmount: Money
}

export type PaymentIntentFailedPayload = {
  readonly providerRef: string
  readonly reason: string // a provider error CODE, never a message with PII
  readonly status: Extract<PaymentStatus, 'failed' | 'expired' | 'cancelled'>
}

export type PaymentIntentRefundPayload = {
  readonly providerRef: string
  readonly amount: Money
  readonly reason: string
  readonly full: boolean
}

export type PaymentIntentFlaggedPayload = {
  readonly providerRef: string
  readonly reason: string // why reconciliation could not resolve it
  readonly at: Instant
}
