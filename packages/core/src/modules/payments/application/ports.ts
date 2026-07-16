import type { Clock, Money, NewEvent, TenantContext } from '../../../shared'
import type { PaymentFlow, PaymentIntent, PaymentProviderId } from '../domain/types'

// ── The PaymentProvider PORT (Plus Phase 6). ─────────────────────────────────────────────────
//
// Business logic never imports PAYTR. It composes a PaymentIntent and calls THIS port; a concrete
// adapter (PaytrProvider) implements it. When no adapter is configured, every method returns
// `configured: false` and the flow shows `configuration_required` — NEVER a fake success (owner).
//
// The two write-side methods create a checkout (a hosted iframe session, or a shareable link). The
// verify method is the security core: it validates the provider's server-to-server callback (hash,
// amount, provider reference) and is the ONLY thing the domain trusts about a payment's outcome.

export interface CreateCheckoutInput {
  readonly intentId: string
  readonly providerRef: string // our merchant_oid — the provider echoes it on the callback
  readonly amount: Money // recomputed from the sale on the server (spec §8/§16)
  readonly itemName: string // what is being paid for (no PII beyond the member's own name)
  readonly memberName: string
  readonly memberEmail: string | null
  readonly memberPhone: string | null
  readonly userIp: string
  readonly okUrl: string
  readonly failUrl: string
  readonly callbackUrl: string
  readonly testMode: boolean
  readonly expiresInSeconds: number
}

export interface CheckoutResult {
  readonly ok: boolean
  readonly configured: boolean // false ⇒ provider_not_configured / configuration_required
  readonly redirectUrl?: string // the iframe/checkout URL or the payment link
  readonly token?: string
  readonly expiresAt?: number // epoch ms
  readonly errorCode?: string
}

export interface RefundInput {
  readonly providerRef: string
  readonly amount: Money
}
export interface RefundResult {
  readonly ok: boolean
  readonly configured: boolean
  readonly providerRef?: string
  readonly errorCode?: string
}

// The verified callback outcome — hash-checked. `valid: false` ⇒ reject the callback (never a grant).
export interface CallbackVerification {
  readonly valid: boolean
  readonly providerRef?: string
  readonly status?: 'success' | 'failed'
  readonly paidAmount?: Money
  readonly failureCode?: string
}

export interface PaymentProviderPort {
  readonly id: PaymentProviderId
  readonly configured: boolean
  createCheckout(flow: PaymentFlow, input: CreateCheckoutInput): Promise<CheckoutResult>
  // Hash/signature verification of the raw callback fields. PURE and synchronous — it computes an HMAC
  // over the provider's documented field order with the merchant salt/key and compares. No I/O.
  verifyCallback(fields: Readonly<Record<string, string>>): CallbackVerification
  refund(input: RefundInput): Promise<RefundResult>
}

// The intent repository — one transactional seam, like finance's `commit`.
export interface PaymentIntentRepository {
  getIntent(ctx: TenantContext, id: string): Promise<PaymentIntent | null>
  getIntentByProviderRef(ctx: TenantContext, providerRef: string): Promise<PaymentIntent | null>
  saveIntent(ctx: TenantContext, intent: PaymentIntent, events: readonly NewEvent[]): Promise<void>
  listPendingOlderThan(ctx: TenantContext, olderThanMs: number): Promise<readonly PaymentIntent[]>
  listByMember(ctx: TenantContext, memberId: string): Promise<readonly PaymentIntent[]>
}

export interface PaymentsDeps {
  readonly repo: PaymentIntentRepository
  readonly clock: Clock
  // Optional: absent ⇒ no provider is configured (the flow returns configuration_required).
  readonly provider?: PaymentProviderPort
}
