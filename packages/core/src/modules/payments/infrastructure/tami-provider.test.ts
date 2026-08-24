import { describe, expect, it } from 'vitest'

import { money } from '../../../shared'
import type { CreateCheckoutInput } from '../application/ports'
import { tamiAuthToken, tamiPhone, tamiProvider, tamiSecurityHash, type TamiConfig } from './tami-provider'

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

describe('tamiSecurityHash — the JWT that signs a query', () => {
  const jwk = { kid: 'kid-1', k: 'c2VjcmV0LWtleS1mb3ItdGVzdA' }

  it('is a three-part HS512 JWT carrying the kid', () => {
    const t = tamiSecurityHash(jwk, { orderId: 'ref_1' })
    const [h, p] = t.split('.')
    expect(t.split('.')).toHaveLength(3)
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ kid: 'kid-1', typ: 'JWT', alg: 'HS512' })
    // The signed payload is the request body with an EMPTY securityHash — the slot the finished
    // token goes into. Signing it with the token already inside would be circular.
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({ orderId: 'ref_1', securityHash: '' })
  })

  it('changes when the order changes — a token is not reusable for another payment', () => {
    expect(tamiSecurityHash(jwk, { orderId: 'a' })).not.toBe(tamiSecurityHash(jwk, { orderId: 'b' }))
  })
})

describe('confirm — the only thing that may credit a TAMI payment', () => {
  const withJwk: TamiConfig = { ...CONFIG, jwk: { kid: 'kid-1', k: 'c2VjcmV0LWtleS1mb3ItdGVzdA' } }

  // The shape below is the REAL one, copied from a ₺1 production payment on 2026-08-24. Until that
  // payment happened these tests asserted `status: 'SUCCESS'` — a field Tami does not send. The
  // adapter passed anyway, because an absent status fell through to "paid". Both the code and the
  // tests agreed with each other and neither agreed with Tami.
  const PAID = {
    success: true,
    orderId: 'ref_1',
    amount: 8000,
    currency: 'TRY',
    orderStatus: 'AUTH',
    paymentStatus: 'SUCCESS',
    installmentCount: 1,
    is3D: true,
  }

  it('credits an unambiguous success, and converts back to kuruş', async () => {
    const p = tamiProvider(withJwk, jsonOnce(PAID))
    const r = await p.confirm!('ref_1')
    expect(r).toMatchObject({ valid: true, status: 'success', providerRef: 'ref_1' })
    expect(r.paidAmount?.amount).toBe(800_000)
  })

  it('rounds rather than truncates — a kuruş lost per payment is still money', async () => {
    const p = tamiProvider(withJwk, jsonOnce({ ...PAID, amount: 79.99 }))
    expect((await p.confirm!('ref_1')).paidAmount?.amount).toBe(7999)
  })

  it('accepts the later states a held authorisation becomes', async () => {
    for (const orderStatus of ['CAPTURE', 'CAPTURED', 'SETTLED']) {
      const p = tamiProvider(withJwk, jsonOnce({ ...PAID, orderStatus }))
      expect((await p.confirm!('ref_1')).valid).toBe(true)
    }
  })

  it('refuses a paymentStatus that is not SUCCESS, and names it', async () => {
    const p = tamiProvider(withJwk, jsonOnce({ ...PAID, paymentStatus: 'PENDING' }))
    expect(await p.confirm!('ref_1')).toMatchObject({ valid: false, failureCode: 'tami_payment_PENDING' })
  })

  it('refuses when paymentStatus is missing entirely — absence is not consent', async () => {
    // The old bug, as a test. `{ success: true }` with no status used to CREDIT.
    const noStatus: Record<string, unknown> = { ...PAID }
    delete noStatus.paymentStatus
    const p = tamiProvider(withJwk, jsonOnce(noStatus))
    expect(await p.confirm!('ref_1')).toMatchObject({ valid: false, failureCode: 'tami_payment_absent' })
  })

  // THE case for the allowlist, observed on 2026-08-24 by paying ₺1 and reversing it. After the
  // reversal Tami still answers `paymentStatus: "SUCCESS"` — it means "the payment succeeded", not
  // "the money is still here". Only `orderStatus` moved, AUTH → REVERSE. Trusting paymentStatus
  // alone would hand a package to someone who took their money back.
  it('refuses a REVERSED payment, which still reports paymentStatus SUCCESS', async () => {
    const reversed = { ...PAID, orderStatus: 'REVERSE', paymentStatus: 'SUCCESS', amount: 0 }
    const r = await tamiProvider(withJwk, jsonOnce(reversed)).confirm!('ref_1')
    expect(r).toMatchObject({ valid: false, failureCode: 'tami_order_REVERSE' })
  })

  it('refuses an unrecognised orderStatus — allowlist, so a refund can never look paid', async () => {
    for (const orderStatus of ['REFUND', 'VOID', 'CANCELLED', 'WHATEVER_TAMI_ADDS_NEXT']) {
      const p = tamiProvider(withJwk, jsonOnce({ ...PAID, orderStatus }))
      const r = await p.confirm!('ref_1')
      expect(r.valid).toBe(false)
      expect(r.failureCode).toBe(`tami_order_${orderStatus}`)
    }
  })

  it('refuses another currency, however well the number matches', async () => {
    const p = tamiProvider(withJwk, jsonOnce({ ...PAID, currency: 'USD' }))
    expect(await p.confirm!('ref_1')).toMatchObject({ valid: false, failureCode: 'tami_currency_USD' })
  })

  // The exact answer production gave for an order that was never paid, on 2026-08-24. Kept as a test
  // rather than a note, because "an unknown order looks like this" is the case that decides whether
  // a member gets a package she did not buy.
  it('refuses Tami\'s real "not this merchant\'s order" answer', async () => {
    const p = tamiProvider(withJwk, jsonOnce({ success: false, errorCode: 2013, errorMessage: 'Bu sipariş üye işyerine ait değildir.' }))
    expect(await p.confirm!('ref_1')).toMatchObject({ valid: false, failureCode: 'tami_not_paid_2013' })
  })

  it('refuses when Tami answers with an error status', async () => {
    const p = tamiProvider(withJwk, jsonOnce({}, 500))
    expect(await p.confirm!('ref_1')).toMatchObject({ valid: false, failureCode: 'tami_query_http_500' })
  })

  it('refuses while the signing key is missing, instead of guessing', async () => {
    const p = tamiProvider(CONFIG, jsonOnce(PAID))
    expect(await p.confirm!('ref_1')).toMatchObject({ valid: false, failureCode: 'tami_jwk_missing' })
  })

  // errorCode 4001, hit for real on 2026-08-24: the SECOND question about a paid order was refused
  // because the correlationId repeated. `confirm` runs more than once by design.
  it('sends a DIFFERENT correlationId each time it asks', async () => {
    const seen: string[] = []
    const spy: typeof fetch = async (_u, init) => {
      seen.push(String((init?.headers as Record<string, string>).correlationId))
      return new Response(JSON.stringify(PAID), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const p = tamiProvider(withJwk, spy)
    await p.confirm!('ref_1')
    await p.confirm!('ref_1')
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
    for (const c of seen) expect(c.startsWith('q-ref_1-')).toBe(true)
  })
})

describe('refund — reverse first, then refund', () => {
  const withJwk: TamiConfig = { ...CONFIG, jwk: { kid: 'kid-1', k: 'c2VjcmV0LWtleS1mb3ItdGVzdA' } }

  /** Answers each call in order, and records where it was sent. */
  function sequence(...replies: { status?: number; body: unknown }[]) {
    const paths: string[] = []
    const bodies: Record<string, unknown>[] = []
    let i = 0
    const impl: typeof fetch = async (url, init) => {
      paths.push(String(url))
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      const r = replies[Math.min(i++, replies.length - 1)]!
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return { impl, paths, bodies }
  }

  it('reverses a same-day payment and never reaches the refund endpoint', async () => {
    const s = sequence({ body: { success: true, orderId: 'ref_1', amount: 1 } })
    const r = await tamiProvider(withJwk, s.impl).refund({ providerRef: 'ref_1', amount: money(100) })
    expect(r).toMatchObject({ ok: true, providerRef: 'ref_1' })
    expect(s.paths).toHaveLength(1)
    expect(s.paths[0]).toContain('/payment/reverse')
  })

  it('falls back to refund when the day has already closed', async () => {
    const s = sequence(
      { status: 400, body: { success: false, errorCode: 2020 } },
      { body: { success: true, orderId: 'ref_1' } },
    )
    const r = await tamiProvider(withJwk, s.impl).refund({ providerRef: 'ref_1', amount: money(100) })
    expect(r.ok).toBe(true)
    expect(s.paths[0]).toContain('/payment/reverse')
    expect(s.paths[1]).toContain('/payment/refund')
  })

  it('names BOTH failures when neither works — "which did we try" is the first question', async () => {
    const s = sequence({ status: 400, body: { success: false, errorCode: 2020 } })
    const r = await tamiProvider(withJwk, s.impl).refund({ providerRef: 'ref_1', amount: money(100) })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('tami_reverse_2020|tami_refund_2020')
  })

  it('always sends the amount — an omitted amount means ALL of it to Tami', async () => {
    // A partial refund that silently becomes a full one is discovered at the bank, not here.
    const s = sequence({ body: { success: true } })
    await tamiProvider(withJwk, s.impl).refund({ providerRef: 'ref_1', amount: money(4250) })
    expect(s.bodies[0]).toMatchObject({ orderId: 'ref_1', amount: 42.5 })
  })

  it('refuses without the signing key rather than reporting money returned', async () => {
    const r = await tamiProvider(CONFIG, jsonOnce({ success: true })).refund({
      providerRef: 'ref_1',
      amount: money(100),
    })
    expect(r).toMatchObject({ ok: false, errorCode: 'tami_refund_requires_jwk' })
  })
})
