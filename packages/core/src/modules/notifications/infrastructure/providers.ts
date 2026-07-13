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
    // eslint-disable-next-line no-console
    console.info(`[email] → ${message.to.email}: ${message.subject}`)
    return { ok: true, providerRef: `console:${message.intentId}`, delivered: false }
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
