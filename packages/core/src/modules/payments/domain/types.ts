import type { ActorRef, Instant, Money, StudioId } from '../../../shared'

// ── PAYMENTS (Plus Phase 6, Doc 26/27 · PAYTR). ──────────────────────────────────────────────
//
//   SALE (open)  →  PAYMENT INTENT  →  PROVIDER SESSION/LINK  →  CALLBACK  →  RESULT  →  COMPLETION
//
// The PaymentIntent is the ONLY thing that talks to a payment provider. The domain never asserts a
// payment succeeded because a browser came back to a success URL — a browser is not a trusted source
// (a card can fail after the redirect). The truth is the provider's server-to-server CALLBACK, hash-
// verified, idempotent, amount-checked. Until then the intent is `awaiting_payment`, the sale is
// `open`, and NOTHING is granted. Card data never enters this system — only a provider reference.

// The central, provider-independent payment status (spec §2). PAYTR's own statuses are mapped to
// these in the adapter; the domain and UI never read a raw provider status.
export type PaymentStatus =
  | 'draft' // built, not yet sent to a provider
  | 'awaiting_payment' // a session/link exists; we are waiting for the member to pay
  | 'processing' // the provider is working on it (or the callback is mid-flight)
  | 'paid' // the CALLBACK confirmed it — the only status that grants anything
  | 'failed' // the provider declined it
  | 'expired' // the session/link timed out unpaid
  | 'cancelled' // a human stopped it before payment
  | 'refund_pending' // a refund was requested, not yet confirmed by the provider
  | 'partially_refunded'
  | 'refunded'
  | 'disputed' // a chargeback / provider dispute
  | 'manual_review' // reconciliation could not resolve it automatically — a human must look

// What the money buys — used to complete the right thing on success.
export type PaymentPurpose = 'package' | 'renewal' | 'product' | 'collection' | 'wallet_topup'

// Sanal POS (an iframe/redirect) vs a shareable payment link.
export type PaymentFlow = 'pos' | 'link'

export type PaymentProviderId = 'paytr'

// The context the callback needs to COMPLETE the sale, frozen at intent creation so completion never
// re-derives a price or a product from a catalogue that may have changed since (spec §16). No card
// data, ever — only ids and the amount already agreed.
export type PaymentIntentContext = {
  // For a package / renewal — the product to grant and the subscription parameters, snapshotted at
  // intent creation so completion never re-derives a price (§16). The PRICE is `PaymentIntent.amount`;
  // these are the rest of the grant.
  readonly productId?: string
  readonly entitlementId?: string // renewal: the membership being renewed (informational)
  readonly priceAgreedKurus?: number // the agreed line price, locked at intent time
  readonly validFrom?: string // LocalDate — when the granted package should start
  readonly validUntil?: string | null
  readonly creditOverride?: number | null
  readonly startAfterCurrent?: boolean // renewal: begin when the current package ends
  readonly note?: string
  // For a retail/product sale — the lines to settle. { retailProductId, description, quantity, unitPriceKurus }.
  readonly lines?: readonly {
    readonly retailProductId: string | null
    readonly description: string
    readonly quantity: number
    readonly unitPriceKurus: number
  }[]
  // For a shareable payment-link collection (PF-37, purpose 'collection') — the buyer's OWN details,
  // collected on our public page (never from PAYTR), so the callback can create an unattributed
  // PaytrCollection. No PII reaches the event; it lives on the collection state written from here.
  readonly linkId?: string
  readonly buyerName?: string
  readonly buyerPhone?: string
  readonly installments?: number
}

export type PaymentIntent = {
  readonly id: string
  readonly studioId: StudioId
  readonly memberId: string
  readonly saleId: string // the OPEN sale this pays — created before the provider is called
  readonly purpose: PaymentPurpose
  readonly amount: Money // recomputed on the server from the sale; never the client's number
  readonly provider: PaymentProviderId
  readonly flow: PaymentFlow
  // The provider's reference for THIS intent — for PAYTR the `merchant_oid` we send and it echoes on
  // the callback. It is how a callback is matched back to an intent. Set at creation; the callback
  // must match it.
  readonly providerRef: string
  // The provider's session token / payment link, once created. Never a secret.
  readonly redirectUrl: string | null
  readonly idempotencyKey: string // one logical payment; a retried create must not double-charge
  readonly status: PaymentStatus
  readonly context: PaymentIntentContext
  readonly expiresAt: Instant | null
  readonly failureReason: string | null
  readonly refundedAmount: Money // net refunded so far (ledger-derived companion on the intent)
  readonly createdBy: ActorRef
  readonly createdAt: Instant
  readonly updatedAt: Instant
}

// The verified outcome of a provider callback (produced by the adapter after hash + amount + tenant
// checks). The domain acts ONLY on this — never on raw callback fields.
export type CallbackVerdict =
  | { readonly ok: true; readonly providerRef: string; readonly paidAmount: Money }
  | { readonly ok: false; readonly providerRef: string; readonly reason: string }

// Whether a status is terminal (no further provider action expected).
export function isTerminalPaymentStatus(s: PaymentStatus): boolean {
  return s === 'paid' || s === 'failed' || s === 'expired' || s === 'cancelled' || s === 'refunded'
}
