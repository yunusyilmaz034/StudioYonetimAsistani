import type { Firestore } from 'firebase-admin/firestore'

import type { TenantContext } from '../../../shared'
import type { NotificationProvider, ProviderResult, RenderedMessage } from '../application/ports'
import { FirestoreNotificationRepository } from './repos'

// ── IN-APP: the only channel that can honestly claim `delivered`. ───────────────────────────
// It is a write to our own database, and it is the member's RECORD of what happened to her account —
// which is why she cannot switch it off.
export class InAppProvider implements NotificationProvider {
  readonly channel = 'in_app' as const
  constructor(private readonly db: Firestore) {}

  async send(ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult> {
    if (!message.to.memberId) {
      // A staff alert has no member inbox yet — it lives in the Notification Center, which staff
      // already read. Saying so is better than pretending we delivered it.
      return { ok: true, providerRef: null, delivered: true }
    }
    await new FirestoreNotificationRepository(this.db).pushInbox(ctx, message.to.memberId, {
      intentId: message.intentId,
      subject: message.subject,
      body: message.body,
      at: Date.now(),
    })
    return { ok: true, providerRef: `inapp:${message.intentId}`, delivered: true }
  }
}

// ── E-MAIL: v1.25 ships the channel; the transport is a seam. ───────────────────────────────
//
// The message is recorded, the attempt is `sent`, and DELIVERY is only ever claimed by a provider
// callback — never by us, and never by the sender library's return value. When a real SMTP/SES
// adapter lands, it replaces this class and nothing else changes.
export class ConsoleEmailProvider implements NotificationProvider {
  readonly channel = 'email' as const

  async send(_ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult> {
    if (!message.to.email) {
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        // Permanent: an address that does not exist will not exist in an hour either, and retrying
        // it is a cost with no upside.
        error: { code: 'missing_address', message: 'no e-mail on file', permanent: true },
      }
    }
    console.info(`[email] → ${message.to.email}: ${message.subject}`)
    return { ok: true, providerRef: `console:${message.intentId}`, delivered: false }
  }
}

// ── E-MAIL, FOR REAL: Resend (owner, 2026-07-13 · DEBT-023). ────────────────────────────────
//
// The first write in this system that LEAVES THE BUILDING. Every other write is reversible inside
// our own database; a sent e-mail is not. That single fact shapes everything below.
//
//   • It reports `sent`, NEVER `delivered`. Resend accepting the message means Resend accepted the
//     message. Whether it reached her inbox is evidence that arrives later, by webhook, and we do
//     not claim it in advance. A Notification Center that says "delivered" when it means "handed
//     over" is a Notification Center that lies to the owner about her own members.
//
//   • It classifies the failure, and it is CONSERVATIVE. A 4xx is permanent (an address that does
//     not exist will not exist in an hour); a 429 or 5xx is transient (their problem, not ours).
//     **Anything it cannot classify is treated as PERMANENT** — because a retry loop against an
//     unknown error is money spent on a guess, forever, at 15-minute intervals.
//
//   • No SDK. The Resend API is one POST. A dependency here buys retries we already have, types we
//     already write, and a supply-chain risk we do not need in the one module that talks to the
//     outside world.
export class ResendEmailProvider implements NotificationProvider {
  readonly channel = 'email' as const

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(_ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult> {
    if (!message.to.email) {
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: { code: 'missing_address', message: 'no e-mail on file', permanent: true },
      }
    }

    let res: Response
    try {
      res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Resend de-duplicates on this. Our trigger is at-least-once, so without it a redelivery
          // is a second e-mail to a member who already got the first — and she does not experience
          // that as "eventual consistency", she experiences it as spam.
          'Idempotency-Key': message.intentId,
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to.email],
          subject: message.subject,
          text: message.body,
        }),
      })
    } catch (err) {
      // The network, not the provider. Their gateway may well be fine in fifteen minutes.
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: {
          code: 'network_error',
          message: err instanceof Error ? err.message : 'fetch failed',
          permanent: false,
        },
      }
    }

    if (res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { id?: string }
      // `delivered: false` — handed over, not arrived. See above; this is the whole discipline.
      return { ok: true, providerRef: payload.id ? `resend:${payload.id}` : null, delivered: false }
    }

    // 429 = rate limited, 5xx = their side. Both are worth another attempt.
    const transient = res.status === 429 || res.status >= 500
    return {
      ok: false,
      providerRef: null,
      delivered: false,
      error: {
        code: `resend_${res.status}`,
        message: await res.text().catch(() => `HTTP ${res.status}`),
        // When we cannot tell, we do NOT spend money on a guess.
        permanent: !transient,
      },
    }
  }
}

// ── SMS / WhatsApp: PORTS ONLY (owner, decision 2). ─────────────────────────────────────────
//
// A mock, so the whole pipeline — intent, attempt, retry, failure, the Notification Center — can be
// tested end to end without a contract, a sender ID or a single kuruş of SMS credit. The real
// adapter lands after Production Hardening, and it lands HERE, alone.
export class MockSmsProvider implements NotificationProvider {
  readonly channel = 'sms' as const
  constructor(private readonly behaviour: 'ok' | 'transient' | 'permanent' = 'ok') {}

  async send(_ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult> {
    if (!message.to.phone) {
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: { code: 'missing_phone', message: 'no phone on file', permanent: true },
      }
    }
    if (this.behaviour === 'transient') {
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: { code: 'gateway_timeout', message: 'mock timeout', permanent: false },
      }
    }
    if (this.behaviour === 'permanent') {
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: { code: 'invalid_number', message: 'mock invalid', permanent: true },
      }
    }
    return { ok: true, providerRef: `mock-sms:${message.intentId}`, delivered: false }
  }
}

// ── WHATSAPP: the seam, and the ONE constraint that has to live outside the adapter. ────────
//
// The owner put WhatsApp ahead of SMS (2026-07-13), and in Türkiye that is obviously right. But
// WhatsApp is not "SMS with a nicer icon", and the difference is architectural:
//
//   **Meta will not carry arbitrary text to a member who has not written to us in 24 hours.**
//
// Inside that window, free text is fine. Outside it — which is where essentially every message we
// send lives, because we are the ones starting the conversation — only a **template Meta itself
// approved, in advance, by name** may be sent. Our Turkish sentence is not enough; Meta needs the
// template's registered name and its ordered parameters.
//
// That is why `RenderedMessage` carries `templateId` and `params` (v1.26) rather than only `body`.
// If this mapping lived inside the adapter, then the day a second provider needs it — a BSP, a
// migration to Twilio, a WhatsApp-like channel in another country — we would discover that the
// information had been thrown away at the boundary.
//
// **`META_TEMPLATE` is the contract with Meta, and it is DATA.** Each of our template ids maps to
// the name approved on their side. A template we have not registered cannot be sent, and this
// class says so out loud rather than silently posting text that Meta will drop.
//
// What is NOT here, deliberately: the HTTP call. It needs a Business Account id, a permanent token,
// a verified number and approved templates — none of which exist yet, and all of which are the
// owner's to obtain. The pipeline is proven against the mock; the real adapter is one method body
// (owner: "production credential gerektiği noktada dur ve owner'dan iste").
export const META_TEMPLATE: Readonly<Record<string, string>> = {
  // our template id            → the name approved on Meta's side
  booking_confirmed: 'booking_confirmed_tr',
  booking_cancelled: 'booking_cancelled_tr',
  session_cancelled: 'session_cancelled_tr',
  membership_expiring: 'membership_expiring_tr',
  low_credit: 'low_credit_tr',
}

export class WhatsAppProvider implements NotificationProvider {
  readonly channel = 'whatsapp' as const

  /**
   * @param send - the transport. Absent, the provider is a MOCK: the whole pipeline (intent,
   *   attempt, retry, quiet hours, the Notification Center) is exercised without a Meta contract, a
   *   verified number, or a single approved template. Present, it is the real thing — and it is the
   *   only thing that changes.
   */
  constructor(
    private readonly send_?: (payload: {
      to: string
      templateName: string
      params: Readonly<Record<string, string>>
    }) => Promise<{ ok: boolean; ref?: string; code?: string; permanent?: boolean }>,
  ) {}

  async send(_ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult> {
    if (!message.to.phone) {
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: { code: 'missing_phone', message: 'no phone on file', permanent: true },
      }
    }

    const templateName = META_TEMPLATE[message.templateId]
    if (!templateName) {
      // PERMANENT, and loudly so. Meta would accept the request and drop the message, and we would
      // report `sent` for something nobody ever received — the worst outcome available to us, because
      // it is a silent one. Better to refuse and let the Notification Center show the refusal.
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: {
          code: 'template_not_approved',
          message: `'${message.templateId}' Meta'da onaylı bir template'e eşlenmemiş`,
          permanent: true,
        },
      }
    }

    if (!this.send_) {
      // The mock. It reports `sent`, never `delivered` — the same honesty the real adapter owes.
      return { ok: true, providerRef: `mock-wa:${message.intentId}`, delivered: false }
    }

    const res = await this.send_({
      to: message.to.phone,
      templateName,
      params: message.params,
    })
    if (res.ok) {
      return { ok: true, providerRef: res.ref ?? `wa:${message.intentId}`, delivered: false }
    }
    return {
      ok: false,
      providerRef: null,
      delivered: false,
      error: {
        code: res.code ?? 'whatsapp_error',
        message: res.code ?? 'whatsapp error',
        // Unknown ⇒ permanent. We do not spend money retrying a guess.
        permanent: res.permanent ?? true,
      },
    }
  }
}
