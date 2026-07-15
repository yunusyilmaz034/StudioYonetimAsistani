import {
  addMoney,
  compareMoney,
  err,
  ok,
  subtractMoney,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type Money,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  PAYMENT_INTENT_CANCELLED,
  PAYMENT_INTENT_CREATED,
  PAYMENT_INTENT_EXPIRED,
  PAYMENT_INTENT_FAILED,
  PAYMENT_INTENT_FLAGGED,
  PAYMENT_INTENT_REFUND_REQUESTED,
  PAYMENT_INTENT_REFUNDED,
  PAYMENT_INTENT_SESSION_CREATED,
  PAYMENT_INTENT_SUCCEEDED,
} from '../events'
import { isTerminalPaymentStatus, type CallbackVerdict, type PaymentIntent, type PaymentStatus } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

export type IntentOutcome = { readonly next: PaymentIntent; readonly events: readonly NewEvent[] }

function base(ctx: DecideContext, intent: PaymentIntent) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind: 'payment_intent' as AggregateKind, id: intent.id },
    related: { memberId: intent.memberId as MemberId, saleId: intent.saleId },
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

export interface CreateIntentInput {
  readonly intent: PaymentIntent // fully built by the application (id, providerRef, amount from the sale)
}

// Create the intent. The application has already built a valid aggregate (amount recomputed from the
// sale on the server — never the client's number, spec §8/§16).
export function decideCreateIntent(ctx: DecideContext, intent: PaymentIntent): IntentOutcome {
  return {
    next: intent,
    events: [
      {
        ...base(ctx, intent),
        type: PAYMENT_INTENT_CREATED,
        payload: {
          saleId: intent.saleId,
          purpose: intent.purpose,
          provider: intent.provider,
          flow: intent.flow,
          providerRef: intent.providerRef,
          amount: intent.amount,
        },
      },
    ],
  }
}

// The provider handed back a token/link. Move to awaiting_payment.
export function decideSessionCreated(
  ctx: DecideContext,
  intent: PaymentIntent,
  redirectUrl: string,
  expiresAt: Instant | null,
): IntentOutcome {
  const next: PaymentIntent = { ...intent, status: 'awaiting_payment', redirectUrl, expiresAt, updatedAt: ctx.now }
  return {
    next,
    events: [
      { ...base(ctx, next), type: PAYMENT_INTENT_SESSION_CREATED, payload: { providerRef: intent.providerRef, hasRedirect: true } },
    ],
  }
}

// The VERIFIED callback outcome. IDEMPOTENT by construction: a replayed callback on an already-terminal
// intent changes nothing and emits nothing — the whole point of the intent existing (spec §9). The
// amount is checked by the ADAPTER before this; here we defend once more that a success matches the
// intent's amount (a provider that confirms the wrong amount is a discrepancy, not a grant).
export function decideCallbackResult(
  ctx: DecideContext,
  intent: PaymentIntent,
  verdict: CallbackVerdict,
): Result<IntentOutcome & { readonly completed: boolean }, DomainError> {
  // Already resolved — a duplicate/late callback. No-op, and that is success (the provider gets "OK").
  if (isTerminalPaymentStatus(intent.status) || intent.status === 'refunded' || intent.status === 'partially_refunded') {
    return ok({ next: intent, events: [], completed: false })
  }
  if (verdict.providerRef !== intent.providerRef) {
    return err({ code: 'payment_ref_mismatch' })
  }

  if (!verdict.ok) {
    const next: PaymentIntent = { ...intent, status: 'failed', failureReason: verdict.reason, updatedAt: ctx.now }
    return ok({
      next,
      events: [
        { ...base(ctx, next), type: PAYMENT_INTENT_FAILED, payload: { providerRef: intent.providerRef, reason: verdict.reason, status: 'failed' as const } },
      ],
      completed: false,
    })
  }

  // A confirmed amount that does not match what we asked for is a discrepancy — never a silent grant.
  if (compareMoney(verdict.paidAmount, intent.amount) !== 0) {
    const next: PaymentIntent = { ...intent, status: 'manual_review', failureReason: 'amount_mismatch', updatedAt: ctx.now }
    return ok({
      next,
      events: [
        { ...base(ctx, next), type: PAYMENT_INTENT_FLAGGED, payload: { providerRef: intent.providerRef, reason: 'amount_mismatch', at: ctx.now } },
      ],
      completed: false,
    })
  }

  const next: PaymentIntent = { ...intent, status: 'paid', updatedAt: ctx.now }
  return ok({
    next,
    events: [
      { ...base(ctx, next), type: PAYMENT_INTENT_SUCCEEDED, payload: { providerRef: intent.providerRef, paidAmount: verdict.paidAmount } },
    ],
    completed: true, // the caller now grants the entitlement / completes the sale, in the same transaction
  })
}

function terminalFail(ctx: DecideContext, intent: PaymentIntent, status: 'expired' | 'cancelled', reason: string): Result<IntentOutcome, DomainError> {
  if (isTerminalPaymentStatus(intent.status)) return err({ code: 'payment_not_pending' })
  const type = status === 'expired' ? PAYMENT_INTENT_EXPIRED : PAYMENT_INTENT_CANCELLED
  const next: PaymentIntent = { ...intent, status, failureReason: reason, updatedAt: ctx.now }
  return ok({ next, events: [{ ...base(ctx, next), type, payload: { providerRef: intent.providerRef, reason, status } }] })
}

export const decideExpire = (ctx: DecideContext, intent: PaymentIntent): Result<IntentOutcome, DomainError> =>
  terminalFail(ctx, intent, 'expired', 'timeout')
export const decideCancel = (ctx: DecideContext, intent: PaymentIntent, reason: string): Result<IntentOutcome, DomainError> =>
  terminalFail(ctx, intent, 'cancelled', reason.trim() || 'cancelled')

// Reconciliation could not resolve it — hand it to a human. Never mutate money silently.
export function decideFlag(ctx: DecideContext, intent: PaymentIntent, reason: string): IntentOutcome {
  const next: PaymentIntent = { ...intent, status: 'manual_review', failureReason: reason, updatedAt: ctx.now }
  return { next, events: [{ ...base(ctx, next), type: PAYMENT_INTENT_FLAGGED, payload: { providerRef: intent.providerRef, reason, at: ctx.now } }] }
}

// A refund is a NEW event, never an edit of the payment. Full or partial; refuses over-refund.
export function decideRequestRefund(
  ctx: DecideContext,
  intent: PaymentIntent,
  amount: Money,
  reason: string,
): Result<IntentOutcome, DomainError> {
  if (intent.status !== 'paid' && intent.status !== 'partially_refunded') return err({ code: 'payment_not_refundable' })
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  if (amount.amount <= 0) return err({ code: 'invalid_amount' })
  const alreadyRefunded = intent.refundedAmount
  const remaining = subtractMoney(intent.amount, alreadyRefunded)
  if (compareMoney(amount, remaining) > 0) return err({ code: 'refund_exceeds_paid' })

  const next: PaymentIntent = { ...intent, status: 'refund_pending', updatedAt: ctx.now }
  const full = compareMoney(amount, remaining) === 0
  return ok({
    next,
    events: [{ ...base(ctx, next), type: PAYMENT_INTENT_REFUND_REQUESTED, payload: { providerRef: intent.providerRef, amount, reason, full } }],
  })
}

// The provider confirmed the refund. Move to (partially_)refunded and accumulate the ledger companion.
export function decideRefundConfirmed(ctx: DecideContext, intent: PaymentIntent, amount: Money, reason: string): IntentOutcome {
  const refundedAmount = addMoney(intent.refundedAmount, amount)
  const full = compareMoney(refundedAmount, intent.amount) >= 0
  const status: PaymentStatus = full ? 'refunded' : 'partially_refunded'
  const next: PaymentIntent = { ...intent, status, refundedAmount, updatedAt: ctx.now }
  return {
    next,
    events: [{ ...base(ctx, next), type: PAYMENT_INTENT_REFUNDED, payload: { providerRef: intent.providerRef, amount, reason, full } }],
  }
}
