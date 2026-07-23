import {
  err,
  instant,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  NOTIFICATION_DELIVERED,
  NOTIFICATION_FAILED,
  NOTIFICATION_INTENT_CREATED,
  NOTIFICATION_QUEUED,
  NOTIFICATION_SENT,
  NOTIFICATION_SUPPRESSED,
} from '../events'
import { TEMPLATES } from './templates'
import {
  DEFAULT_RETRY,
  type Category,
  type Channel,
  type DeliveryAttempt,
  type NotificationIntent,
  type NotificationPrefs,
  type NotificationSettings,
  type NotificationTemplate,
  type Priority,
  type RecipientRef,
  type SuppressionReason,
} from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId // = the OperationId of the act that caused this (OP-2)
  readonly source: EventSource
}

const base = (ctx: DecideContext, id: string, related: Record<string, string>) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'member' as AggregateKind, id },
  related,
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

// ── RENDER — pure. A template that cannot be fully rendered is a DEFECT, never a message that says
//    "Merhaba {{memberName}}". We would rather send nothing than send that.
export interface Rendered {
  readonly subject: string
  readonly body: string
}

export function render(
  template: NotificationTemplate,
  params: Readonly<Record<string, string>>,
): Result<Rendered, DomainError> {
  const missing = template.requiredParams.filter((p) => !params[p])
  if (missing.length > 0) return err({ code: 'template_params_missing', missing })

  const fill = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? '')

  const body = fill(template.body)
  // A placeholder that survived rendering means the template asks for something nobody declared.
  if (/\{\{\w+\}\}/.test(body)) return err({ code: 'template_params_missing', missing: ['unknown'] })
  return ok({ subject: fill(template.subject), body })
}

// ── CHANNEL SELECTION — preferences, contact details, and what the studio has actually enabled.
//
// `in_app` is never filtered out by a preference: it is not a message, it is her record of what
// happened to her account. Turning it off would be turning off her own history.
export interface ChannelDecision {
  readonly channels: readonly Channel[]
  readonly suppressed: readonly { channel: Channel; reason: SuppressionReason }[]
}

export function selectChannels(
  recipient: RecipientRef,
  prefs: NotificationPrefs,
  settings: NotificationSettings,
  category: Category,
): ChannelDecision {
  const channels: Channel[] = []
  const suppressed: { channel: Channel; reason: SuppressionReason }[] = []

  for (const channel of settings.enabledChannels) {
    if (channel === 'in_app') {
      channels.push(channel)
      continue
    }
    // The KVKK line. A MARKETING message needs the member's explicit campaign consent; an OPERATIONAL
    // one (her class was cancelled) never does. Without consent the marketing send is suppressed
    // with `no_consent` — the reason is recorded, so a suppressed campaign is never a silent one.
    if (category === 'marketing' && !prefs.campaign) {
      suppressed.push({ channel, reason: 'no_consent' })
      continue
    }
    const allowed =
      channel === 'email'
        ? prefs.email
        : channel === 'sms'
          ? prefs.sms
          : channel === 'whatsapp'
            ? prefs.whatsapp
            : prefs.push
    if (!allowed) {
      // She may say "not by SMS". She may NOT say "never tell me my class was cancelled" — which is
      // why `in_app` is above this branch and cannot be reached by it.
      suppressed.push({ channel, reason: 'member_preference' })
      continue
    }
    // Push's "address" is the member herself — her device tokens are resolved at delivery time by the
    // PushProvider (they change, and they are not PII to carry here). A staff recipient has no app, so
    // push is not an address for her.
    const address =
      channel === 'email' ? recipient.email : channel === 'push' ? (recipient.kind === 'member' ? recipient.id : null) : recipient.phone
    if (!address) {
      suppressed.push({ channel, reason: 'missing_contact' })
      continue
    }
    channels.push(channel)
  }
  return { channels, suppressed }
}

// ── QUIET HOURS — priority decides (owner, decision 4). URGENT never waits: a class cancelled for
//    tomorrow morning cannot sit in a queue until 08:00. LOW/NORMAL wait; the alternative is waking
//    a member at 23:40 to tell her tomorrow's class moved, which is worse than the delay.
export function isQuietHour(
  now: Instant,
  settings: NotificationSettings,
  utcOffsetMinutes: number,
): boolean {
  const hour = Math.floor(((now + utcOffsetMinutes * 60_000) % 86_400_000) / 3_600_000)
  const { quietFromHour: from, quietToHour: to } = settings
  return from > to ? hour >= from || hour < to : hour >= from && hour < to
}

export const waitsForQuietHours = (priority: Priority): boolean =>
  priority !== 'urgent' && priority !== 'high'

// ── INTENT ──────────────────────────────────────────────────────────────────────────────────
export interface CreateIntentInput {
  readonly intentId: string // DERIVED (hash of event + template + recipient): idempotent by design
  readonly eventId: string | null
  readonly eventType: string
  readonly templateId: string
  readonly recipient: RecipientRef
  readonly params: Readonly<Record<string, string>>
  readonly prefs: NotificationPrefs
  readonly settings: NotificationSettings
  readonly sentToday: number
  // Plus Phase 5 — the RESOLVED template: the studio's override if it has one, else the code seed.
  // The caller resolves it so this stays pure. Absent ⇒ fall back to the code catalogue.
  readonly template?: NotificationTemplate
  // A DELIBERATE channel override (a desk-initiated WhatsApp template send): the staff explicitly
  // chose the channel, so it is used verbatim, bypassing the consent-derived selection. Manual, 1:1,
  // owner-driven — never a path an automated event can take. Absent ⇒ consent decides (the default).
  readonly forceChannels?: readonly Channel[]
}

export function decideCreateIntent(
  ctx: DecideContext,
  input: CreateIntentInput,
): Result<{ intent: NotificationIntent; events: readonly NewEvent[] }, DomainError> {
  const template = input.template ?? TEMPLATES[input.templateId]
  if (!template) return err({ code: 'template_not_found' })
  // A deactivated template stops NEW sends (the owner turned it off); past sends keep their snapshot.
  if (template.active === false) return err({ code: 'template_inactive' })

  // The daily ceiling (owner, decision 3). A runaway loop must cost a WARNING, not a month's
  // revenue — so when the limit trips we stop creating intents and say so, loudly.
  if (input.sentToday >= input.settings.dailyLimit) {
    return err({ code: 'daily_limit_reached', limit: input.settings.dailyLimit })
  }

  const rendered = render(template, input.params)
  if (!rendered.ok) return rendered

  const decision = input.forceChannels
    ? { channels: input.forceChannels, suppressed: [] }
    : selectChannels(input.recipient, input.prefs, input.settings, template.category)

  const intent: NotificationIntent = {
    id: input.intentId,
    studioId: ctx.studioId,
    eventId: input.eventId,
    eventType: input.eventType,
    operationId: ctx.correlationId,
    templateId: template.id,
    templateVersion: template.version,
    category: template.category,
    priority: template.priority,
    recipient: input.recipient,
    params: input.params,
    channels: decision.channels,
    createdAt: ctx.now,
    createdBy: ctx.actor,
    cancelled: false,
  }

  const events: NewEvent[] = [
    {
      ...base(ctx, intent.id, recipientRelated(input.recipient)),
      type: NOTIFICATION_INTENT_CREATED,
      // I-38: the template and the channels — never the body, never the address.
      payload: {
        templateId: template.id,
        templateVersion: template.version,
        channels: decision.channels,
        priority: template.priority,
        category: template.category,
        recipientKind: input.recipient.kind,
        causedByEventType: input.eventType,
      },
    },
    // A silent suppression is indistinguishable from a bug. It is an event, always.
    ...decision.suppressed.map((s) => ({
      ...base(ctx, intent.id, recipientRelated(input.recipient)),
      type: NOTIFICATION_SUPPRESSED,
      payload: { intentId: intent.id, templateId: template.id, channel: s.channel, reason: s.reason },
    })),
  ]

  return ok({ intent, events })
}

const recipientRelated = (r: RecipientRef): Record<string, string> =>
  r.kind === 'member' ? { memberId: r.id } : {}

// ── ATTEMPTS ────────────────────────────────────────────────────────────────────────────────
export function newAttempt(
  ctx: DecideContext,
  intent: NotificationIntent,
  channel: Channel,
  rendered: Rendered,
  queued: boolean,
): { attempt: DeliveryAttempt; events: readonly NewEvent[] } {
  const attempt: DeliveryAttempt = {
    id: `${intent.id}:${channel}:1`,
    studioId: ctx.studioId,
    intentId: intent.id,
    channel,
    status: queued ? 'queued' : 'pending',
    attemptNo: 1,
    nextRetryAt: null,
    error: null,
    suppression: null,
    providerRef: null,
    queuedAt: queued ? ctx.now : null,
    sentAt: null,
    deliveredAt: null,
    subject: rendered.subject, // PII-bearing, like the intent. Never in an event (I-38).
    body: rendered.body,
  }
  return {
    attempt,
    events: queued
      ? [
          {
            ...base(ctx, intent.id, recipientRelated(intent.recipient)),
            type: NOTIFICATION_QUEUED,
            payload: {
              intentId: intent.id,
              templateId: intent.templateId,
              channel,
              status: 'queued',
              attemptNo: 1,
            },
          },
        ]
      : [],
  }
}

// The provider's answer is EVIDENCE, not truth (owner rule 4). This is where we record what WE
// believe happened; a later provider callback may update it, but it never replaces it.
export function decideAttemptResult(
  ctx: DecideContext,
  intent: NotificationIntent,
  attempt: DeliveryAttempt,
  result:
    | { readonly ok: true; readonly providerRef: string | null; readonly delivered: boolean }
    | { readonly ok: false; readonly code: string; readonly message: string; readonly permanent: boolean },
): { attempt: DeliveryAttempt; events: readonly NewEvent[] } {
  if (result.ok) {
    const next: DeliveryAttempt = {
      ...attempt,
      // in_app is a write to our own database: if it succeeded, it IS delivered. Nothing else can
      // claim that honestly.
      status: result.delivered ? 'delivered' : 'sent',
      providerRef: result.providerRef,
      sentAt: ctx.now,
      deliveredAt: result.delivered ? ctx.now : null,
      error: null,
    }
    return {
      attempt: next,
      events: [
        {
          ...base(ctx, intent.id, recipientRelated(intent.recipient)),
          type: result.delivered ? NOTIFICATION_DELIVERED : NOTIFICATION_SENT,
          payload: {
            intentId: intent.id,
            templateId: intent.templateId,
            channel: attempt.channel,
            status: next.status,
            attemptNo: attempt.attemptNo,
          },
        },
      ],
    }
  }

  // Plus Phase 5 — the channel has no real transport (WhatsApp without Meta credentials). Its own
  // terminal status, never a retry: retrying a channel that does not exist yet is a loop that ends
  // when someone provisions credentials, not when a timer fires. The Notification Center shows it as
  // "sağlayıcı yapılandırılmamış" so the owner knows to connect the channel, not to chase a bug.
  const notConfigured = result.code === 'provider_not_configured' || result.code === 'no_provider'

  // A permanent failure is NOT retried: an invalid phone number will still be invalid in an hour,
  // and retrying it is a bill with no upside. When a provider will not tell us which it is, we treat
  // it as permanent — we do not spend money on a guess.
  const policy = DEFAULT_RETRY[attempt.channel]
  const canRetry = !notConfigured && !result.permanent && attempt.attemptNo < policy.maxAttempts
  const backoff = policy.backoffMinutes[attempt.attemptNo - 1] ?? 0

  const next: DeliveryAttempt = {
    ...attempt,
    status: notConfigured ? 'provider_not_configured' : canRetry ? 'queued' : 'failed',
    error: { code: result.code, message: result.message, permanent: result.permanent },
    nextRetryAt: canRetry ? instant(ctx.now + backoff * 60_000) : null,
  }

  return {
    attempt: next,
    events: [
      {
        ...base(ctx, intent.id, recipientRelated(intent.recipient)),
        type: NOTIFICATION_FAILED,
        payload: {
          intentId: intent.id,
          templateId: intent.templateId,
          channel: attempt.channel,
          status: next.status,
          attemptNo: attempt.attemptNo,
          errorCode: result.code, // what went wrong — never the message, never the address
          permanent: result.permanent,
        },
      },
    ],
  }
}

// A retry is a NEW attempt, not a mutation of the old one — the same discipline as a payment void:
// history is appended to, never edited.
export const retryOf = (attempt: DeliveryAttempt): DeliveryAttempt => ({
  ...attempt,
  id: `${attempt.intentId}:${attempt.channel}:${attempt.attemptNo + 1}`,
  attemptNo: attempt.attemptNo + 1,
  status: 'pending',
  nextRetryAt: null,
  error: null,
})
