import { describe, expect, it } from 'vitest'

import { money } from '../../../shared'
import type { CreateCheckoutInput } from '../application/ports'
import { tamiAuthToken, tamiPhone, tamiProvider, type TamiConfig } from './tami-provider'

const CONFIG: TamiConfig = {
  merchantNumber: '77006950',
  terminalNumber: '84006953',
  secretKey: '0edad05a-7ea7-40f1-a80c-d600121ca51b',
  testMode: true,
}

const INPUT: CreateCheckoutInput = {
  intentId: 'pin_1',
  providerRef: 'ref_1',
  amount: money(800_000), // 8.000 ₺
  itemName: 'Fitness - 3 Aylık',
  memberName: 'Üye',
  memberEmail: null,
  memberPhone: '+905331994123',
  userIp: '1.2.3.4',
  okUrl: 'https://panel.example.com/ok',
  failUrl: 'https://panel.example.com/fail',
  callbackUrl: 'https://panel.example.com/cb',
  testMode: true,
  expiresInSeconds: 900,
  maxInstallment: 3,
}

const jsonOnce = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('tamiAuthToken', () => {
  // The value on the right is the token Tami publishes in its own Postman collection for this test
  // merchant. If this test ever fails, the header formula changed — not the test.
  it('reproduces the token Tami ships for the same credentials', () => {
    expect(tamiAuthToken(CONFIG)).toBe('77006950:84006953:Y1b81CLYkxvCvw/LhNwS+5c+cSgVGBH2bcAEg1Ik93Y=')
  })
})

describe('tamiPhone — Masterpass will not authenticate without it', () => {
  it.each([
    ['+905331994123', '905331994123'],
    ['05331994123', '905331994123'],
    ['5331994123', '905331994123'],
    ['+90 533 199 41 23', '905331994123'],
  ])('%s → %s', (input, expected) => {
    expect(tamiPhone(input)).toBe(expected)
  })

  it('gives an empty string rather than a wrong number when there is none', () => {
    expect(tamiPhone(null)).toBe('')
  })
})

describe('createCheckout', () => {
  it('returns the hosted page URL carrying the minted token', async () => {
    const p = tamiProvider(CONFIG, jsonOnce({ oneTimeToken: 'tok+A/B=', tokenCreateTime: '2026-08-17T22:00:00' }))
    const r = await p.createCheckout('link', INPUT)
    expect(r.ok).toBe(true)
    // The token is base64 and WILL contain + and =; a raw concatenation would corrupt it.
    expect(r.redirectUrl).toBe('https://sandbox-portal.tami.com.tr/hostedPaymentPage?token=tok%2BA%2FB%3D')
  })

  it('sends major units, not kuruş — 8.000 ₺ is 8000, never 800000', async () => {
    let sent: Record<string, unknown> = {}
    const spy = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ oneTimeToken: 't' }), { status: 200 })
    }) as unknown as typeof fetch

    await tamiProvider(CONFIG, spy).createCheckout('link', INPUT)
    expect(sent.amount).toBe(8000)
    expect(sent.mobilePhoneNumber).toBe('905331994123')
    expect(sent.orderId).toBe('ref_1')
  })

  it('fails loudly when Tami refuses, rather than returning a URL to nowhere', async () => {
    const p = tamiProvider(CONFIG, jsonOnce({ error: 'nope' }, 400))
    const r = await p.createCheckout('link', INPUT)
    expect(r).toMatchObject({ ok: false, configured: true, errorCode: 'tami_http_400' })
  })

  it('is unconfigured — never a fake success — when there are no credentials', async () => {
    const r = await tamiProvider(null).createCheckout('link', INPUT)
    expect(r.configured).toBe(false)
    expect(r.ok).toBe(false)
  })
})

describe('verifyCallback — the redirect is not evidence', () => {
  // Tami sends the CUSTOMER back, not a signed server-to-server callback. Anyone who learns the URL
  // could otherwise grant themselves a package by opening it. This must never be softened into a
  // pass "just to get the flow working" — completion comes from asking Tami, not from being told.
  it('refuses, whatever the redirect claims', () => {
    const p = tamiProvider(CONFIG)
    expect(p.verifyCallback({ status: 'success', orderId: 'ref_1', amount: '8000' })).toEqual({
      valid: false,
      failureCode: 'tami_callback_unsigned',
    })
  })

  it('refuses an empty callback too', () => {
    expect(tamiProvider(CONFIG).verifyCallback({}).valid).toBe(false)
  })
})

describe('refund', () => {
  it('refuses while the signing key is missing, instead of reporting money returned', async () => {
    const r = await tamiProvider(CONFIG).refund({ providerRef: 'ref_1', amount: money(800_000) })
    expect(r).toMatchObject({ ok: false, errorCode: 'tami_refund_requires_jwk' })
  })
})
