import type { Channel, DeliveryStatus, SuppressionReason } from './domain/types'

// ⚠ I-38 — a notification's RENDERED BODY never enters the event log. These events say THAT we tried
// to reach her, on which channel, with which template, and how it went. They never say what the
// message said, and they never carry her phone number or e-mail address. Identity and content live
// on the intent (erasable with the member); behaviour lives here (permanent, anonymous).

export const NOTIFICATION_INTENT_CREATED = 'notification.intent_created'
export const NOTIFICATION_QUEUED = 'notification.queued'
export const NOTIFICATION_SENT = 'notification.sent'
export const NOTIFICATION_DELIVERED = 'notification.delivered'
export const NOTIFICATION_FAILED = 'notification.failed'
export const NOTIFICATION_SUPPRESSED = 'notification.suppressed'
export const NOTIFICATION_RETRIED = 'notification.retried'

export type NotificationIntentCreatedPayload = {
  readonly templateId: string
  readonly templateVersion: number
  readonly channels: readonly Channel[]
  readonly priority: string
  readonly category: string
  readonly recipientKind: 'member' | 'staff'
  readonly causedByEventType: string
}

export type NotificationAttemptPayload = {
  readonly intentId: string
  readonly templateId: string
  readonly channel: Channel
  readonly status: DeliveryStatus
  readonly attemptNo: number
}

export type NotificationFailedPayload = NotificationAttemptPayload & {
  readonly errorCode: string
  readonly permanent: boolean
  // NOT the message, NOT the address — only what went wrong.
}

export type NotificationSuppressedPayload = {
  readonly intentId: string
  readonly templateId: string
  readonly channel: Channel
  // A silent suppression is indistinguishable from a bug. This is why it is an event.
  readonly reason: SuppressionReason
}
