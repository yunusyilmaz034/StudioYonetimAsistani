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
// "Richer e-mail" (Plus Phase 5) — a minimal, client-safe HTML shell around the rendered body. No
// external assets (many clients strip them), inline styles only, and every dynamic value is escaped:
// the body is trusted studio copy, but escaping is the habit that survives the day it isn't.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'))
}
// The studio's identity for the e-mail chrome — the header name, the warm sign-off, the address and
// its directions link. All of it is DATA (the studio's settings), never a literal in here: this file
// is shared by every tenant, and a studio name compiled into it is one that is wrong for the next
// customer (Doc 0 · the platform is not one studio).
export interface EmailBrand {
  readonly studioName?: string
  readonly address?: string | null
  readonly mapsUrl?: string | null // Google Maps / directions link → the "Yol tarifi al" button
}

export function renderEmailHtml(subject: string, body: string, brand: EmailBrand = {}): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('')
  const name = brand.studioName?.trim() || 'Studio'
  const address = brand.address?.trim()
  const maps = brand.mapsUrl?.trim()
  // A warm sign-off, built from the studio's own name so it reads as coming from a team, not a system.
  const signoff = `${escapeHtml(name)} ekibi olarak her zaman yanınızdayız 💜`
  const footer = `<tr><td style="padding:22px 28px;background:#faf6f4;border-top:1px solid #efe6e2">
<p style="margin:0 0 ${address || maps ? '10px' : '0'};font-size:14px;color:#6b5a63;line-height:1.6">${signoff}</p>
${address ? `<p style="margin:0 0 ${maps ? '12px' : '0'};font-size:13px;color:#8a7a82;line-height:1.5">${escapeHtml(address)}</p>` : ''}
${maps ? `<a href="${escapeHtml(maps)}" style="display:inline-block;background:#a22d60;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:8px">📍 Yol tarifi al</a>` : ''}
</td></tr>`
  return `<!doctype html><html lang="tr"><body style="margin:0;background:#f4eeec;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2028">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(43,32,40,.08)">
<tr><td style="background:#a22d60;padding:18px 28px"><span style="color:#fff;font-size:17px;font-weight:700;letter-spacing:.2px">${escapeHtml(name)}</span></td></tr>
<tr><td style="padding:26px 28px 8px;font-size:15px"><h1 style="margin:0 0 14px;font-size:18px;font-weight:600;color:#2b2028">${escapeHtml(subject)}</h1>${paragraphs}</td></tr>
${footer}
</table></td></tr></table></body></html>`
}

export class ResendEmailProvider implements NotificationProvider {
  readonly channel = 'email' as const

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly brand: EmailBrand = {},
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
          // Plain text stays (the accessible, deliverable fallback every client renders); the HTML
          // part is the "richer e-mail" — a clean branded shell around the same rendered body.
          text: message.body,
          html: renderEmailHtml(message.subject, message.body, this.brand),
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
// Each of our template ids → the name Meta approved AND the ORDERED params its body expects. Meta
// templates are positional ({{1}}, {{2}}, …), so the order here is the contract: the owner must
// register each `<id>_tr` template with its body params in exactly this order. Member-facing
// operational templates only — staff alerts go to the owner in-app/e-mail, never over WhatsApp.
export interface MetaTemplateRef {
  readonly name: string
  readonly params: readonly string[]
}
export const META_TEMPLATE: Readonly<Record<string, MetaTemplateRef>> = {
  booking_confirmed: { name: 'booking_confirmed_tr', params: ['memberName', 'sessionName', 'sessionTime'] },
  booking_cancelled: { name: 'booking_cancelled_tr', params: ['memberName', 'sessionName', 'sessionTime'] },
  booking_moved: { name: 'booking_moved_tr', params: ['memberName', 'fromTime', 'toTime'] },
  session_cancelled: { name: 'session_cancelled_tr', params: ['memberName', 'sessionName', 'sessionTime'] },
  waitlist_promoted: { name: 'waitlist_promoted_tr', params: ['memberName', 'sessionName', 'sessionTime'] },
  closure_applied: { name: 'closure_applied_tr', params: ['memberName', 'reason', 'sessionCount'] },
  package_created: { name: 'package_created_tr', params: ['memberName', 'productName'] },
  package_expiring: { name: 'package_expiring_tr', params: ['memberName', 'productName', 'daysLeft'] },
  package_expired: { name: 'package_expired_tr', params: ['memberName', 'productName'] },
  session_rescheduled: { name: 'session_rescheduled_tr', params: ['memberName', 'sessionName', 'fromTime', 'toTime'] },
  credits_low: { name: 'credits_low_tr', params: ['memberName', 'remaining'] },
  credits_exhausted: { name: 'credits_exhausted_tr', params: ['memberName'] },
  payment_received: { name: 'payment_received_tr', params: ['memberName', 'amount'] },
  balance_reminder: { name: 'balance_reminder_tr', params: ['memberName', 'amount'] },
  instalment_due: { name: 'instalment_due_tr', params: ['memberName', 'amount', 'dueDate'] },
  portal_invite: { name: 'portal_invite_tr', params: ['memberName', 'inviteLink'] },
  wallet_topup: { name: 'wallet_topup_tr', params: ['memberName', 'amount', 'balance'] },
}

// The WhatsApp transport (the `send_` the provider is given). Absent ⇒ the provider is a mock.
export type WhatsAppTransport = (payload: {
  readonly to: string
  readonly templateName: string
  readonly params: readonly string[]
}) => Promise<{ ok: boolean; ref?: string; code?: string; permanent?: boolean }>

export class WhatsAppProvider implements NotificationProvider {
  readonly channel = 'whatsapp' as const

  /**
   * @param send - the transport. Absent, the provider is a MOCK: the whole pipeline (intent,
   *   attempt, retry, quiet hours, the Notification Center) is exercised without a Meta contract, a
   *   verified number, or a single approved template. Present, it is the real thing — and it is the
   *   only thing that changes.
   */
  constructor(private readonly send_?: WhatsAppTransport) {}

  async send(_ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult> {
    if (!message.to.phone) {
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: { code: 'missing_phone', message: 'no phone on file', permanent: true },
      }
    }

    const tmpl = META_TEMPLATE[message.templateId]
    if (!tmpl) {
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
      // NO transport configured — and we do NOT fake a success (owner, Plus Phase 5). A mock `sent`
      // is the one outcome worse than a failure, because nobody goes looking for a message the system
      // said it delivered. We say plainly that the channel is not configured; the Notification Center
      // shows it, and the manual wa.me action stays the working path until Meta credentials exist.
      return {
        ok: false,
        providerRef: null,
        delivered: false,
        error: { code: 'provider_not_configured', message: 'WhatsApp Meta entegrasyonu yapılandırılmamış', permanent: true },
      }
    }

    // Meta templates are POSITIONAL — build the ordered value list from the template's declared param
    // order and the intent's params. A missing param becomes '' rather than crashing the send.
    const orderedParams = tmpl.params.map((k) => message.params[k] ?? '')
    const res = await this.send_({ to: message.to.phone, templateName: tmpl.name, params: orderedParams })
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

// ── META CLOUD API, FOR REAL (Plus Phase 5). ────────────────────────────────────────────────
//
// The one method body the WhatsApp seam was waiting for. It POSTs an approved TEMPLATE message to
// the Graph API — never free text, because outside the 24-hour window Meta carries only templates it
// approved by name. Same discipline as Resend: it reports handed-over (`ok`), never `delivered`
// (that is a webhook, later); it classifies conservatively (4xx permanent, 429/5xx transient, unknown
// permanent — a retry loop against a guess is money spent forever). Credentials are the OWNER's to
// provision (WABA phone-number id + a permanent token); absent them the factory hands back the mock.
export interface MetaWhatsAppConfig {
  readonly phoneNumberId: string
  readonly accessToken: string
  readonly apiVersion?: string // default v21.0
  readonly languageCode?: string // default 'tr'
}

export function metaWhatsAppTransport(config: MetaWhatsAppConfig, fetchImpl: typeof fetch = fetch): WhatsAppTransport {
  const version = config.apiVersion ?? 'v21.0'
  const language = config.languageCode ?? 'tr'
  return async (payload) => {
    // Meta wants the number as digits, no '+'.
    const to = payload.to.replace(/\D/g, '')
    let res: Response
    try {
      res = await fetchImpl(`https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: payload.templateName,
            language: { code: language },
            components: payload.params.length
              ? [{ type: 'body', parameters: payload.params.map((text) => ({ type: 'text', text })) }]
              : [],
          },
        }),
      })
    } catch {
      // The network, not Meta — worth another attempt in fifteen minutes.
      return { ok: false, code: 'network_error', permanent: false }
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] }
      const id = body.messages?.[0]?.id
      return id ? { ok: true, ref: id } : { ok: true }
    }
    const transient = res.status === 429 || res.status >= 500
    return { ok: false, code: `meta_${res.status}`, permanent: !transient }
  }
}

// ── One provider registry, built from config — used by BOTH the functions trigger and the web
//    resend action, so a channel that is real in production is real when reception resends. A channel
//    with credentials becomes real; without them it falls back to its honest stub/mock. ──
export interface NotificationProvidersConfig {
  readonly email?: { readonly apiKey: string; readonly from: string; readonly brand?: EmailBrand }
  readonly whatsapp?: MetaWhatsAppConfig
}

// ── PUSH: Expo Push Service (M2). ───────────────────────────────────────────────────────────
//
// A device token is not PII (#6 is untouched — the message body is rendered from templates + names at
// send time, exactly like e-mail/WhatsApp; the event still records only that we tried). Tokens are
// resolved HERE, at delivery, from the member's `devices` subcollection — so the intent pipeline and
// RecipientRef never change. No provider credentials are needed for a basic Expo push.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export class PushProvider implements NotificationProvider {
  readonly channel = 'push' as const
  constructor(
    private readonly db: Firestore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult> {
    if (!message.to.memberId) return { ok: true, providerRef: null, delivered: false }
    const snap = await this.db
      .collection('studios').doc(ctx.studioId)
      .collection('members').doc(message.to.memberId)
      .collection('devices').get()
    const tokens = snap.docs
      .map((d) => d.get('token') as string | undefined)
      .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'))
    // No registered device is not a failure — she simply has not installed the app. Retrying would
    // never help, so we report a clean non-delivery, not an error.
    if (tokens.length === 0) return { ok: true, providerRef: null, delivered: false }

    try {
      const res = await this.fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({ to, title: message.subject, body: message.body, data: { intentId: message.intentId } }))),
      })
      if (!res.ok) return { ok: false, providerRef: null, delivered: false, error: { code: 'push_http', message: `HTTP ${res.status}`, permanent: res.status >= 400 && res.status < 500 } }
      const json = (await res.json().catch(() => ({}))) as { data?: { status?: string }[] }
      const anyOk = (json.data ?? []).some((r) => r.status === 'ok')
      // The receipt (final delivery) arrives later from Expo; "sent" is the honest claim here, like SMS.
      return { ok: anyOk, providerRef: `expo:${message.intentId}`, delivered: false, ...(anyOk ? {} : { error: { code: 'push_rejected', message: 'Expo rejected all tokens', permanent: false } }) }
    } catch (e) {
      return { ok: false, providerRef: null, delivered: false, error: { code: 'push_network', message: (e as Error).message, permanent: false } }
    }
  }
}

export function standardNotificationProviders(
  db: Firestore,
  config: NotificationProvidersConfig = {},
): NotificationProvider[] {
  return [
    new InAppProvider(db),
    config.email ? new ResendEmailProvider(config.email.apiKey, config.email.from, fetch, config.email.brand) : new ConsoleEmailProvider(),
    new WhatsAppProvider(config.whatsapp ? metaWhatsAppTransport(config.whatsapp) : undefined),
    new PushProvider(db),
  ]
}
