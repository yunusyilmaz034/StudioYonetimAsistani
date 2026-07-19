import type { Firestore } from 'firebase-admin/firestore'
import { describe, expect, it } from 'vitest'

import type { TenantContext } from '../../../shared'
import type { RenderedMessage } from '../application/ports'
import {
  ConsoleEmailProvider,
  InAppProvider,
  metaWhatsAppTransport,
  ResendEmailProvider,
  standardNotificationProviders,
  WhatsAppProvider,
} from './providers'

// The two providers that talk to the outside world (v1.26).
//
// Everything else in this system is reversible inside our own database. A sent message is not — and
// a message we *claim* to have sent is worse than one we failed to send, because nobody goes looking
// for it. So both of these are tested for what they SAY as much as for what they do.

const ctx = {} as TenantContext

const message = (over: Partial<RenderedMessage> = {}): RenderedMessage => ({
  to: { email: 'uye@example.com', phone: '+905321234567', memberId: 'mem_1' },
  subject: 'Dersiniz iptal edildi',
  body: 'Merhaba Elif, yarınki Reformer dersiniz iptal edildi.',
  intentId: 'ntf_1',
  channel: 'email',
  templateId: 'session_cancelled',
  params: { memberName: 'Elif', sessionName: 'Reformer', sessionTime: '10:00' },
  ...over,
})

// A stub `fetch`. No network, ever — a unit test that can reach the internet is a unit test that
// can send a real member a real e-mail on somebody's laptop.
const respondWith = (status: number, body: unknown = {}) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

describe('Resend — the first write that leaves the building', () => {
  it('reports SENT, never DELIVERED', async () => {
    const provider = new ResendEmailProvider('key', 'noreply@studio.test', respondWith(200, { id: 'abc' }))
    const res = await provider.send(ctx, message())

    expect(res.ok).toBe(true)
    expect(res.providerRef).toBe('resend:abc')
    // Resend accepting the message means Resend accepted the message. Whether it reached her inbox
    // is evidence that arrives later, by webhook. A Notification Center that says "delivered" when
    // it means "handed over" lies to the owner about her own members.
    expect(res.delivered).toBe(false)
  })

  it('sends an idempotency key — a redelivered trigger must not become a second e-mail', async () => {
    let seen: Record<string, string> = {}
    const spyFetch = (async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await new ResendEmailProvider('key', 'x@y.z', spyFetch).send(ctx, message())

    // Our trigger is at-least-once. Without this header, a redelivery is a second e-mail to a member
    // who already got the first — and she does not experience that as eventual consistency.
    expect(seen['Idempotency-Key']).toBe('ntf_1')
  })

  it('treats a 4xx as PERMANENT — an address that does not exist will not exist in an hour', async () => {
    const res = await new ResendEmailProvider('k', 'f', respondWith(422)).send(ctx, message())
    expect(res.ok).toBe(false)
    expect(res.error?.permanent).toBe(true)
  })

  it('treats 429 and 5xx as TRANSIENT — their problem, not ours', async () => {
    const rateLimited = await new ResendEmailProvider('k', 'f', respondWith(429)).send(ctx, message())
    expect(rateLimited.error?.permanent).toBe(false)

    const theirOutage = await new ResendEmailProvider('k', 'f', respondWith(503)).send(ctx, message())
    expect(theirOutage.error?.permanent).toBe(false)
  })

  it('treats a network failure as TRANSIENT, and refuses a missing address as PERMANENT', async () => {
    const boom = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const network = await new ResendEmailProvider('k', 'f', boom).send(ctx, message())
    expect(network.error?.permanent).toBe(false)

    const noAddress = await new ResendEmailProvider('k', 'f', respondWith(200)).send(
      ctx,
      message({ to: { email: null, phone: null, memberId: 'mem_1' } }),
    )
    expect(noAddress.ok).toBe(false)
    expect(noAddress.error?.permanent).toBe(true) // retrying an absence costs money and finds nothing
  })
})

describe('WhatsApp — the 24-hour window, and the template it forces', () => {
  it('refuses a template Meta has not approved, PERMANENTLY', async () => {
    // Meta would accept the request and DROP the message, and we would report `sent` for something
    // nobody received. That is the worst outcome available to us, because it is a silent one.
    const res = await new WhatsAppProvider().send(
      ctx,
      message({ channel: 'whatsapp', templateId: 'a_template_nobody_registered' }),
    )

    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('template_not_approved')
    expect(res.error?.permanent).toBe(true)
  })

  it('maps our template id to the name approved on Meta’s side, and passes the ORDERED params', async () => {
    let sent: { to: string; templateName: string; params: readonly string[] } | null = null
    const provider = new WhatsAppProvider(async (payload) => {
      sent = payload
      return { ok: true, ref: 'wamid.123' }
    })

    const res = await provider.send(ctx, message({ channel: 'whatsapp' }))

    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(false) // handed to Meta, not read by Elif
    // Outside the 24-hour window — which is where every message we START lives — Meta needs the
    // registered template NAME and its POSITIONAL parameters, not our Turkish sentence.
    expect(sent!.templateName).toBe('session_cancelled_tr')
    expect(sent!.params[0]).toBe('Elif') // memberName is the first body param for session_cancelled
  })

  it('with NO transport reports provider_not_configured — never a fake send (Plus Phase 5)', async () => {
    const res = await new WhatsAppProvider().send(ctx, message({ channel: 'whatsapp' }))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('provider_not_configured')
    expect(res.error?.permanent).toBe(true) // terminal — a channel with no credentials is not a retry
    expect(res.delivered).toBe(false)
  })

  it('treats an unclassifiable provider error as PERMANENT — we never spend money on a guess', async () => {
    const provider = new WhatsAppProvider(async () => ({ ok: false, code: 'something_unknown' }))
    const res = await provider.send(ctx, message({ channel: 'whatsapp' }))
    expect(res.error?.permanent).toBe(true)
  })
})

// ── Meta Cloud API transport + the unified registry (Plus Phase 5) ───────────────────────────
const captureFetch = (status: number, body: unknown = {}) => {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('metaWhatsAppTransport — the real Meta Cloud API adapter', () => {
  it('POSTs an approved TEMPLATE with positional params, digits-only number, and returns the wamid', async () => {
    const { impl, calls } = captureFetch(200, { messages: [{ id: 'wamid.HB' }] })
    const send = metaWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok' }, impl)
    const res = await send({ to: '+90 532 123 45 67', templateName: 'session_cancelled_tr', params: ['Elif', 'Reformer', '10:00'] })

    expect(res.ok).toBe(true)
    expect(res.ref).toBe('wamid.HB')
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/pn_1/messages')
    const sent = JSON.parse(calls[0]!.init.body as string)
    expect(sent.to).toBe('905321234567') // digits, no '+', no spaces
    expect(sent.type).toBe('template')
    expect(sent.template.name).toBe('session_cancelled_tr')
    expect(sent.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Elif', 'Reformer', '10:00'])
  })
  it('classifies a 4xx as permanent and a 5xx as transient', async () => {
    const bad = metaWhatsAppTransport({ phoneNumberId: 'p', accessToken: 't' }, captureFetch(400).impl)
    expect((await bad({ to: '9', templateName: 'x', params: [] })).permanent).toBe(true)
    const flaky = metaWhatsAppTransport({ phoneNumberId: 'p', accessToken: 't' }, captureFetch(503).impl)
    expect((await flaky({ to: '9', templateName: 'x', params: [] })).permanent).toBe(false)
  })
})

describe('standardNotificationProviders — one registry for functions and web', () => {
  const db = {} as Firestore
  it('falls back to console e-mail + mock WhatsApp with no config', () => {
    const ps = standardNotificationProviders(db)
    expect(ps.map((p) => p.channel)).toEqual(['in_app', 'email', 'whatsapp', 'push'])
    expect(ps[1]).toBeInstanceOf(ConsoleEmailProvider)
    expect(ps[0]).toBeInstanceOf(InAppProvider)
  })
  it('uses the real e-mail transport when configured', () => {
    const ps = standardNotificationProviders(db, { email: { apiKey: 'k', from: 'f@s.test' } })
    expect(ps[1]).toBeInstanceOf(ResendEmailProvider)
  })
})
