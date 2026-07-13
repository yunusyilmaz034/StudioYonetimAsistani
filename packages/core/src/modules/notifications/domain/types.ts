import type { ActorRef, Instant, StudioId } from '../../../shared'

// ── NOTIFICATIONS (v1.25, Doc 28). ──────────────────────────────────────────────────────────
//
//   DOMAIN EVENT  →  NOTIFICATION INTENT  →  DELIVERY ATTEMPT
//   (immutable,      "she should be told     "we tried to reach her
//    already free)    this thing"             on THIS channel"
//
// The separation is load-bearing. **The domain never calls a provider**: a booking that fails
// because an SMS gateway is down is an outage the studio never signed up for. The domain writes its
// event and finishes; everything here is downstream, asynchronous and failable — and a failure here
// must never fail the thing that actually happened.
//
// The INTENT is the decision to inform: audience, category, preference, consent, quiet hours,
// deduplication all live there. The ATTEMPT is plumbing. Collapsing them would put KVKK logic inside
// a retry loop, which is exactly where nobody will look for it in 2028.

export type Channel = 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push'

// The KVKK line, decided by the TEMPLATE and never reclassified at send time. A template is born
// operational or marketing; reclassification is precisely how a campaign gets sent under the
// contract's legal basis. v1.25 sends operational only.
export type Category = 'operational' | 'marketing'

// URGENT ignores quiet hours (owner): a class cancelled for tomorrow morning cannot wait until 08:00.
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export type Audience = 'member' | 'owner' | 'reception' | 'roster'

export type DeliveryStatus =
  | 'pending' // created, not yet handed to a channel
  | 'queued' // waiting (quiet hours, or a retry's backoff)
  | 'sent' // the provider accepted it
  | 'delivered' // the provider (or our own DB, for in_app) confirmed it arrived
  | 'failed' // permanently, or out of retries
  | 'cancelled' // a human stopped it
  | 'suppressed' // WE chose not to send: preference · consent · budget ceiling

// Why we chose not to send. A silent suppression is indistinguishable from a bug.
export type SuppressionReason =
  | 'member_preference'
  | 'no_consent'
  | 'daily_limit'
  | 'missing_contact' // no e-mail / no phone on file
  | 'duplicate'

export interface RecipientRef {
  readonly kind: 'member' | 'staff'
  readonly id: string
  // Resolved from STATE at intent time — events carry no PII (#6), and a message needs an address.
  readonly email: string | null
  readonly phone: string | null
  readonly displayName: string
}

// ⚠ I-38 — the rendered body NEVER enters the event log. The intent is PII-bearing (it holds her
// name, her phone and the sentence we sent her); it lives in /notificationIntents, it is erased with
// the member, and the events say only THAT we tried, on which channel, with which template, and how
// it went.
export interface NotificationIntent {
  readonly id: string // DERIVED: hash(eventId, templateId, recipientId) — idempotent by construction
  readonly studioId: StudioId
  readonly eventId: string | null
  readonly eventType: string
  readonly operationId: string // OP-2 — the act that caused it; the Activity Center joins on this
  readonly templateId: string
  readonly templateVersion: number
  readonly category: Category
  readonly priority: Priority
  readonly recipient: RecipientRef
  readonly params: Readonly<Record<string, string>>
  readonly channels: readonly Channel[] // after preferences were applied
  readonly createdAt: Instant
  readonly createdBy: ActorRef // the principal whose act triggered it (usually not the recipient)
  readonly cancelled: boolean
}

export interface DeliveryAttempt {
  readonly id: string // `${intentId}:${channel}:${attemptNo}` — idempotent by construction
  readonly studioId: StudioId
  readonly intentId: string
  readonly channel: Channel
  readonly status: DeliveryStatus
  readonly attemptNo: number
  readonly nextRetryAt: Instant | null
  readonly error: { readonly code: string; readonly message: string; readonly permanent: boolean } | null
  readonly suppression: SuppressionReason | null
  // The provider's answer is EVIDENCE, not truth. Providers lose messages, report `delivered` for a
  // disconnected phone, and go out of business. Our aggregate is the record.
  readonly providerRef: string | null
  readonly queuedAt: Instant | null
  readonly sentAt: Instant | null
  readonly deliveredAt: Instant | null
  readonly subject: string | null // rendered — PII-bearing, like the intent. Never in an event.
  readonly body: string | null
}

// Per member, per channel. `in_app` is deliberately absent: it is not a message, it is her record of
// what happened to her account, and turning it off would be turning off her own history.
export interface NotificationPrefs {
  readonly email: boolean
  readonly sms: boolean
  readonly whatsapp: boolean
  readonly push: boolean
}

export const DEFAULT_PREFS: NotificationPrefs = {
  email: true,
  sms: true,
  whatsapp: false,
  push: false,
}

// Retry is DATA, per channel (#4 — nothing in the code knows the number three). Every SMS retry
// costs money; the ceiling is deliberate, not an oversight.
export interface RetryPolicy {
  readonly maxAttempts: number
  readonly backoffMinutes: readonly number[]
}

export const DEFAULT_RETRY: Readonly<Record<Channel, RetryPolicy>> = {
  // in_app is a write to our own database. If that fails, everything is failing, and a retry is not
  // the answer.
  in_app: { maxAttempts: 1, backoffMinutes: [] },
  email: { maxAttempts: 3, backoffMinutes: [5, 30, 240] },
  sms: { maxAttempts: 2, backoffMinutes: [5, 60] },
  whatsapp: { maxAttempts: 2, backoffMinutes: [5, 60] },
  push: { maxAttempts: 3, backoffMinutes: [1, 5, 30] },
}

export interface NotificationSettings {
  readonly dailyLimit: number // owner: 1000 operational messages/day, in studio settings
  readonly quietFromHour: number // 22
  readonly quietToHour: number // 8
  readonly enabledChannels: readonly Channel[]
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  dailyLimit: 1000,
  quietFromHour: 22,
  quietToHour: 8,
  enabledChannels: ['in_app', 'email'], // v1.25: SMS/WhatsApp/push are PORTS, not channels yet
}

export interface NotificationTemplate {
  readonly id: string
  readonly version: number
  readonly name: string
  readonly category: Category
  readonly priority: Priority
  readonly requiredParams: readonly string[]
  readonly subject: string // for e-mail; ignored by in-app
  readonly body: string // Turkish, with {{param}} placeholders. No technical event names, ever.
}
