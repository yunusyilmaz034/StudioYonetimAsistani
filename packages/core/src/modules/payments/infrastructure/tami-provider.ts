import { createHash } from 'node:crypto'

import type {
  CallbackVerification,
  CheckoutResult,
  CreateCheckoutInput,
  PaymentProviderPort,
  RefundResult,
} from '../application/ports'
import type { PaymentFlow } from '../domain/types'
import { UnconfiguredPaymentProvider } from './paytr-provider'

// ── TAMI ADAPTER — Ortak Ödeme Sayfası (2026-08-17, https://dev.tami.com.tr) ─────────────────
//
// The second implementation of the PaymentProvider port, and the reason the port exists. Everything
// above it is unchanged: the intent, the events, the reconciliation. Only this file speaks Tami.
//
// ── WHY THE HOSTED PAGE AND NOT THE CARD API ────────────────────────────────────────────────
//
// Tami's catalogue leads with a direct Sanal POS where the merchant posts the PAN and CVV itself.
// That would pull the studio into PCI DSS scope for no gain. The hosted page keeps card data on
// Tami's side, exactly as PAYTR's iframe does — the owner chose it deliberately on 2026-08-17.
//
// ── THE FLOW ────────────────────────────────────────────────────────────────────────────────
//
//   1. mint a one-time token          POST /hosted/create-one-time-hosted-token
//   2. send her to                    {portal}/hostedPaymentPage?token=<oneTimeToken>
//   3. she pays there; Tami redirects her back to our successCallbackUrl
//   4. WE ASK TAMI whether it really happened                    ← see verifyCallback
//
// ── STEP 4 IS THE WHOLE SECURITY MODEL ──────────────────────────────────────────────────────
//
// Nothing signed comes back. The customer simply arrives at a URL of ours, and a URL anyone can
// type is not evidence of a payment. PAYTR sends a server-to-server callback we HMAC-verify; Tami
// sends a browser. Tami's own documentation says the same in as many words: "İşyerinin cevap
// alamadığı durumda, tami/Query servisi ile işlem durumunu sorgulaması beklenir."
//
// So `verifyCallback` here can only ever answer "no". That is not a stub and must not be softened
// into one: a `payment.received` written on the strength of a redirect is money invented by whoever
// typed the address bar. Completion waits for the Query call, which needs the per-merchant JWK
// (`k`/`kid`) that arrives with the real account.
//
// Secrets (secretKey) come from Secret Manager and live only in this adapter's config — never in the
// repo, a log, the UI, or an event payload.

export interface TamiConfig {
  readonly merchantNumber: string
  readonly terminalNumber: string
  /** Tami calls it "Secret Key" / apiKey. Signs the auth header; never leaves this file. */
  readonly secretKey: string
  readonly testMode: boolean
}

const API = {
  test: 'https://sandbox-paymentapi.tami.com.tr',
  prod: 'https://paymentapi.tami.com.tr',
} as const

const PORTAL = {
  test: 'https://sandbox-portal.tami.com.tr',
  prod: 'https://portal.tami.com.tr',
} as const

/**
 * `merchant:terminal:Base64(SHA256(merchant + terminal + secretKey))`.
 *
 * Derived here rather than fetched from Tami's `/admin/generate-hash`: one less network call on the
 * path a member is waiting on, and one less way to be wrong at 22:00. Verified by reproducing the
 * exact token Tami ships in its own Postman collection.
 */
export const tamiAuthToken = (c: TamiConfig): string => {
  const hash = createHash('sha256').update(`${c.merchantNumber}${c.terminalNumber}${c.secretKey}`, 'utf8').digest('base64')
  return `${c.merchantNumber}:${c.terminalNumber}:${hash}`
}

/**
 * Masterpass will not authenticate without it, and it must be `905xxxxxxxxx` — no `+`, no spaces,
 * no leading zero. We store E.164 (`+905…`), so this is the one place the two shapes meet.
 */
export const tamiPhone = (phone: string | null): string => {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.startsWith('90')) return digits
  if (digits.startsWith('0')) return `90${digits.slice(1)}`
  return digits ? `90${digits}` : ''
}

class TamiProvider implements PaymentProviderPort {
  readonly id = 'tami' as const
  readonly configured = true

  constructor(
    private readonly config: TamiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private base(): string {
    return this.config.testMode ? API.test : API.prod
  }

  private portal(): string {
    return this.config.testMode ? PORTAL.test : PORTAL.prod
  }

  async createCheckout(_flow: PaymentFlow, input: CreateCheckoutInput): Promise<CheckoutResult> {
    // `flow` is ignored on purpose: Tami's hosted page IS both the iframe and the link. The same URL
    // can be opened in a frame at the desk or sent to her on WhatsApp — there is nothing to branch on.
    try {
      const res = await this.fetchImpl(`${this.base()}/hosted/create-one-time-hosted-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'tr',
          'PG-Api-Version': 'v3',
          correlationId: input.intentId,
          'PG-Auth-Token': tamiAuthToken(this.config),
        },
        body: JSON.stringify({
          // Tami wants a decimal in major units — NOT kuruş. Our Money is integer kuruş, so this is
          // the boundary where the two meet, and the only place the division may happen.
          amount: input.amount.amount / 100,
          orderId: input.providerRef,
          successCallbackUrl: input.okUrl,
          // Tami does not currently redirect on failure — it keeps her on its own page with the
          // error and a retry. Sent anyway, so the day they wire it up we are already correct.
          failCallbackUrl: input.failUrl,
          mobilePhoneNumber: tamiPhone(input.memberPhone),
        }),
      })

      const body = (await res.json().catch(() => ({}))) as { oneTimeToken?: string; tokenCreateTime?: string }
      if (!res.ok || !body.oneTimeToken) {
        return { ok: false, configured: true, errorCode: `tami_http_${res.status}` }
      }

      return {
        ok: true,
        configured: true,
        token: body.oneTimeToken,
        redirectUrl: `${this.portal()}/hostedPaymentPage?token=${encodeURIComponent(body.oneTimeToken)}`,
        // 15 minutes in test, SIX in production. The short one is the one that will surprise
        // somebody, so it is the one the intent should expire on.
        expiresAt: Date.now() + (this.config.testMode ? 15 : 6) * 60_000,
      }
    } catch {
      return { ok: false, configured: true, errorCode: 'tami_unreachable' }
    }
  }

  /**
   * Always `valid: false`, and deliberately.
   *
   * Tami's "callback" is a browser redirect carrying no signature. There is nothing here to verify,
   * so there is nothing here that may grant. Anyone who learns the URL could otherwise hand
   * themselves a package by typing it.
   *
   * The outcome is established by asking Tami — `/payment/query` on the orderId — which needs the
   * per-merchant JWK that arrives with the real account. Until that exists, a TAMI payment cannot
   * complete, and that is the correct failure: a member who paid and is not yet credited is a phone
   * call, while a member credited without paying is a loss nobody notices.
   */
  verifyCallback(): CallbackVerification {
    return { valid: false, failureCode: 'tami_callback_unsigned' }
  }

  async refund(): Promise<RefundResult> {
    // `/payment/reverse` and `/payment/refund` both want a JWK-signed `securityHash`. Refusing is
    // honest; pretending would leave reception believing money went back when it did not.
    return { ok: false, configured: true, errorCode: 'tami_refund_requires_jwk' }
  }
}

export function tamiProvider(config: TamiConfig | null, fetchImpl: typeof fetch = fetch): PaymentProviderPort {
  return config ? new TamiProvider(config, fetchImpl) : new UnconfiguredPaymentProvider()
}
