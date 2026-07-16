import { createHmac } from 'node:crypto'

import { money, type Money } from '../../../shared'
import type {
  CallbackVerification,
  CheckoutResult,
  CreateCheckoutInput,
  PaymentProviderPort,
  RefundInput,
  RefundResult,
} from '../application/ports'
import type { PaymentFlow } from '../domain/types'

// ── PAYTR ADAPTER (Plus Phase 6, https://dev.paytr.com/). ────────────────────────────────────
//
// The one place PAYTR is spoken. Everything above it talks the PaymentProvider PORT; swapping to
// another provider (or a BSP) is a new adapter, nothing else. Card data NEVER passes through here —
// PAYTR's hosted iframe/link collects it; we only ever send an amount and a reference, and receive a
// server-to-server callback we HASH-VERIFY.
//
// The hash formulas follow PAYTR's documented iFrame + Link APIs. They are the security core: a token
// the merchant cannot forge, and a callback the merchant can verify. ⚠ When real credentials arrive,
// verify these against the official iFrame API zip before going live (they are the canonical forms).
//
// Secrets (merchant_key, merchant_salt) come from Secret Manager and live ONLY in this adapter's
// config — never in the repo, a log, the UI, or an event payload (owner, §1).

export interface PaytrConfig {
  readonly merchantId: string
  readonly merchantKey: string
  readonly merchantSalt: string
  readonly testMode: boolean
}

const TOKEN_URL = 'https://www.paytr.com/odeme/api/get-token'
const LINK_CREATE_URL = 'https://www.paytr.com/odeme/api/link/create'
const REFUND_URL = 'https://www.paytr.com/odeme/api/iade'
const IFRAME_BASE = 'https://www.paytr.com/odeme/guvenli/'

const b64hmac = (key: string, data: string): string => createHmac('sha256', key).update(data, 'utf8').digest('base64')
const lira = (m: Money): string => (m.amount / 100).toFixed(2)

export class PaytrProvider implements PaymentProviderPort {
  readonly id = 'paytr' as const
  readonly configured = true

  constructor(
    private readonly config: PaytrConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCheckout(flow: PaymentFlow, input: CreateCheckoutInput): Promise<CheckoutResult> {
    return flow === 'link' ? this.createLink(input) : this.createPosSession(input)
  }

  // ── Sanal POS (iFrame API, get-token). ──
  private async createPosSession(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const { merchantId, merchantKey, merchantSalt, testMode } = this.config
    const paymentAmount = String(input.amount.amount) // kuruş, integer
    const testFlag = testMode ? '1' : '0'
    const noInstallment = '0'
    const maxInstallment = '0'
    const currency = 'TL'
    // A single-line basket: [[name, unitPriceTL, count]]. base64(JSON).
    const basket = Buffer.from(JSON.stringify([[input.itemName, lira(input.amount), 1]]), 'utf8').toString('base64')

    // paytr_token = base64( HMAC_SHA256( merchant_id + user_ip + merchant_oid + email + payment_amount
    //   + user_basket + no_installment + max_installment + currency + test_mode + merchant_salt, key ) )
    const hashStr =
      merchantId +
      input.userIp +
      input.providerRef +
      (input.memberEmail ?? '') +
      paymentAmount +
      basket +
      noInstallment +
      maxInstallment +
      currency +
      testFlag +
      merchantSalt
    const paytrToken = b64hmac(merchantKey, hashStr)

    const body = new URLSearchParams({
      merchant_id: merchantId,
      user_ip: input.userIp,
      merchant_oid: input.providerRef,
      email: input.memberEmail ?? 'noreply@example.com',
      payment_amount: paymentAmount,
      paytr_token: paytrToken,
      user_basket: basket,
      debug_on: testMode ? '1' : '0',
      no_installment: noInstallment,
      max_installment: maxInstallment,
      user_name: input.memberName,
      user_address: '-',
      user_phone: input.memberPhone ?? '-',
      merchant_ok_url: input.okUrl,
      merchant_fail_url: input.failUrl,
      timeout_limit: String(Math.max(1, Math.round(input.expiresInSeconds / 60))),
      currency,
      test_mode: testFlag,
    })

    try {
      const res = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      const json = (await res.json().catch(() => ({}))) as { status?: string; token?: string; reason?: string }
      if (json.status === 'success' && json.token) {
        return { ok: true, configured: true, redirectUrl: IFRAME_BASE + json.token, token: json.token }
      }
      return { ok: false, configured: true, errorCode: json.reason ?? 'paytr_token_failed' }
    } catch {
      return { ok: false, configured: true, errorCode: 'network_error' }
    }
  }

  // ── Link ile Ödeme (Link API, create). ──
  private async createLink(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const { merchantId, merchantKey, merchantSalt, testMode } = this.config
    const price = String(input.amount.amount) // kuruş
    // paytr_token = base64( HMAC_SHA256( name + price + currency + max_installment + link_type + lang
    //   + min_count + merchant_salt, key ) ) — the documented Link-create order.
    const currency = 'TL'
    const maxInstallment = '0'
    const linkType = 'product'
    const lang = 'tr'
    const minCount = '1'
    const hashStr = input.itemName + price + currency + maxInstallment + linkType + lang + minCount + merchantSalt
    const paytrToken = b64hmac(merchantKey, hashStr)

    const body = new URLSearchParams({
      merchant_id: merchantId,
      name: input.itemName,
      price,
      currency,
      max_installment: maxInstallment,
      link_type: linkType,
      lang,
      min_count: minCount,
      email: input.memberEmail ?? '',
      callback_link: input.callbackUrl,
      callback_id: input.providerRef,
      debug_on: testMode ? '1' : '0',
      paytr_token: paytrToken,
    })

    try {
      const res = await this.fetchImpl(LINK_CREATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      const json = (await res.json().catch(() => ({}))) as { status?: string; link?: string; reason?: string }
      if (json.status === 'success' && json.link) return { ok: true, configured: true, redirectUrl: json.link }
      return { ok: false, configured: true, errorCode: json.reason ?? 'paytr_link_failed' }
    } catch {
      return { ok: false, configured: true, errorCode: 'network_error' }
    }
  }

  // ── Callback verification (notification hash). ──
  // hash = base64( HMAC_SHA256( merchant_oid + merchant_salt + status + total_amount, merchant_key ) )
  // Reject on ANY mismatch — an unverified callback is never a grant (spec §9).
  verifyCallback(fields: Readonly<Record<string, string>>): CallbackVerification {
    const merchantOid = fields.merchant_oid ?? ''
    const status = fields.status ?? ''
    const totalAmount = fields.total_amount ?? ''
    const posted = fields.hash ?? ''
    const expected = b64hmac(this.config.merchantKey, merchantOid + this.config.merchantSalt + status + totalAmount)
    if (!posted || posted !== expected) return { valid: false }
    if (status === 'success') {
      // total_amount is in kuruş, integer.
      const amount = Number(totalAmount)
      if (!Number.isInteger(amount) || amount < 0) return { valid: false }
      return { valid: true, providerRef: merchantOid, status: 'success', paidAmount: money(amount) }
    }
    return { valid: true, providerRef: merchantOid, status: 'failed', failureCode: fields.failed_reason_code ?? 'failed' }
  }

  // ── Refund (iade). ──
  async refund(input: RefundInput): Promise<RefundResult> {
    const { merchantId, merchantKey, merchantSalt } = this.config
    const returnAmount = lira(input.amount) // PAYTR iade expects TL with two decimals
    const paytrToken = b64hmac(merchantKey, merchantId + input.providerRef + returnAmount + merchantSalt)
    const body = new URLSearchParams({
      merchant_id: merchantId,
      merchant_oid: input.providerRef,
      return_amount: returnAmount,
      paytr_token: paytrToken,
    })
    try {
      const res = await this.fetchImpl(REFUND_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      const json = (await res.json().catch(() => ({}))) as { status?: string; err_msg?: string }
      return json.status === 'success'
        ? { ok: true, configured: true, providerRef: input.providerRef }
        : { ok: false, configured: true, errorCode: json.err_msg ?? 'paytr_refund_failed' }
    } catch {
      return { ok: false, configured: true, errorCode: 'network_error' }
    }
  }
}

// The "not configured" provider — every method is honest: no session, no fake success. The flow shows
// `configuration_required` and the owner is told to connect PAYTR in Ayarlar › Entegrasyonlar.
export class UnconfiguredPaymentProvider implements PaymentProviderPort {
  readonly id = 'paytr' as const
  readonly configured = false
  async createCheckout(): Promise<CheckoutResult> {
    return { ok: false, configured: false, errorCode: 'configuration_required' }
  }
  verifyCallback(): CallbackVerification {
    return { valid: false }
  }
  async refund(): Promise<RefundResult> {
    return { ok: false, configured: false, errorCode: 'configuration_required' }
  }
}

export function paytrProvider(config: PaytrConfig | null, fetchImpl: typeof fetch = fetch): PaymentProviderPort {
  return config ? new PaytrProvider(config, fetchImpl) : new UnconfiguredPaymentProvider()
}
