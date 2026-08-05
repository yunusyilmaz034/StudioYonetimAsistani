import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { money } from '../../../shared'
import type { CreateCheckoutInput } from '../application/ports'
import { PaytrProvider } from './paytr-provider'

// The token is an HMAC over fields we ALSO send in the body. If the two ever disagree — by one
// character, in one field — PAYTR cannot verify the token and the payment never starts. On 2026-08-05
// that is exactly what happened at the desk: the hash signed '' for a member with no e-mail address
// while the body carried a placeholder, so every member without an e-mail was unable to pay by card.
// These tests recompute PAYTR's hash from the body that was actually posted, which is the only check
// that catches a mismatch in ANY field rather than the one we happened to think of.

const CFG = { merchantId: '123456', merchantKey: 'k'.repeat(16), merchantSalt: 's'.repeat(16), testMode: false }

const input = (over: Partial<CreateCheckoutInput> = {}): CreateCheckoutInput => ({
  intentId: 'pin_1',
  providerRef: 'abc123def456',
  amount: money(700_000),
  itemName: 'Fitness - 2 Aylık',
  memberName: 'YUNUS TEST',
  memberEmail: null,
  memberPhone: '+905000000001',
  userIp: '85.34.78.112',
  okUrl: 'https://example.test/return',
  failUrl: 'https://example.test/return',
  callbackUrl: 'https://example.test/callback',
  testMode: false,
  expiresInSeconds: 1800,
  maxInstallment: 0,
  ...over,
})

// Capture the form PAYTR would have received, and answer with a token so the call resolves.
function capture(): { fetchImpl: typeof fetch; sent: () => URLSearchParams } {
  let sent: URLSearchParams | undefined
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = new URLSearchParams(String(init?.body))
    return new Response(JSON.stringify({ status: 'success', token: 'tok_1' }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, sent: () => sent! }
}

// PAYTR's documented iFrame order, recomputed over the POSTED values.
const expectedToken = (f: URLSearchParams): string =>
  createHmac('sha256', CFG.merchantKey)
    .update(
      CFG.merchantId +
        f.get('user_ip')! +
        f.get('merchant_oid')! +
        f.get('email')! +
        f.get('payment_amount')! +
        f.get('user_basket')! +
        f.get('no_installment')! +
        f.get('max_installment')! +
        f.get('currency')! +
        f.get('test_mode')! +
        CFG.merchantSalt,
      'utf8',
    )
    .digest('base64')

describe('PaytrProvider · POS token signs exactly what it sends', () => {
  it('verifies for a member WITHOUT an e-mail address — the case that broke live', async () => {
    const c = capture()
    const res = await new PaytrProvider(CFG, c.fetchImpl).createCheckout('pos', input({ memberEmail: null }))
    expect(res.ok).toBe(true)
    const f = c.sent()
    expect(f.get('email')).toBeTruthy() // PAYTR requires one; a placeholder stands in
    expect(f.get('paytr_token')).toBe(expectedToken(f))
  })

  it('verifies for a member WITH an e-mail address', async () => {
    const c = capture()
    await new PaytrProvider(CFG, c.fetchImpl).createCheckout('pos', input({ memberEmail: 'uye@example.com' }))
    const f = c.sent()
    expect(f.get('email')).toBe('uye@example.com')
    expect(f.get('paytr_token')).toBe(expectedToken(f))
  })

  it('verifies for tek çekim, where no_installment and max_installment both move', async () => {
    const c = capture()
    await new PaytrProvider(CFG, c.fetchImpl).createCheckout('pos', input({ maxInstallment: 1 }))
    const f = c.sent()
    expect([f.get('no_installment'), f.get('max_installment')]).toEqual(['1', '0'])
    expect(f.get('paytr_token')).toBe(expectedToken(f))
  })

  it('asks PAYTR for a reason even in live mode', async () => {
    const c = capture()
    await new PaytrProvider(CFG, c.fetchImpl).createCheckout('pos', input())
    // debug_on='0' makes a rejected token come back as a zero-byte body, which is indistinguishable
    // from every other failure. The error text is ours to read, not the cardholder's.
    expect(c.sent().get('debug_on')).toBe('1')
  })
})

describe('PaytrProvider · a reply it cannot parse says so', () => {
  it('reports the status and length instead of swallowing an empty body', async () => {
    const fetchImpl = (async () => new Response('', { status: 200 })) as unknown as typeof fetch
    const res = await new PaytrProvider(CFG, fetchImpl).createCheckout('pos', input())
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('paytr_bad_response_http_200_0b')
  })

  it('passes PAYTR own reason through when there is one', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: 'failed', reason: 'paytr_token gecersiz' }), {
        status: 200,
      })) as unknown as typeof fetch
    const res = await new PaytrProvider(CFG, fetchImpl).createCheckout('pos', input())
    expect(res.errorCode).toBe('paytr_token gecersiz')
  })
})
