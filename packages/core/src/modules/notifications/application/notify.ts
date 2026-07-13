import {
  instant,
  newOperationId,
  type DomainError,
  type EventSource,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideAttemptResult,
  decideCreateIntent,
  isQuietHour,
  newAttempt,
  render,
  retryOf,
  waitsForQuietHours,
  type DecideContext,
} from '../domain/decide'
import { TEMPLATES } from '../domain/templates'
import {
  DEFAULT_PREFS,
  type Channel,
  type DeliveryAttempt,
  type NotificationIntent,
  type RecipientRef,
} from '../domain/types'
import type { NotificationDeps, RenderedMessage } from './ports'

// ── THE DISPATCHER (v1.25). ─────────────────────────────────────────────────────────────────
//
// It runs DOWNSTREAM of the domain, always. Nothing in `modules/reservations` or `modules/finance`
// knows this file exists: a booking that fails because an SMS gateway is down is an outage the studio
// never signed up for.
//
// One intent fans out to N independent channel attempts. **A channel failing does not touch the
// others** (owner rule 3) — the in-app notification is already delivered while the e-mail is still
// retrying, and that is the correct answer, not a compromise.

const SOURCE: EventSource = 'system_notify'

const dctx = (
  deps: NotificationDeps,
  ctx: TenantContext,
  operationId: string,
): DecideContext => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  // OP-2 — the intent inherits the OperationId of the act that caused it, so the Activity Center can
  // show "the closure → the 12 cancellations → the ONE message we sent her" as one story.
  correlationId: operationId as never,
  source: SOURCE,
})

export interface NotifyInput {
  readonly intentId: string // DERIVED by the caller: hash(eventId, templateId, recipientId)
  readonly eventId: string | null
  readonly eventType: string
  readonly operationId: string
  readonly templateId: string
  readonly recipient: RecipientRef
  readonly params: Readonly<Record<string, string>>
}

// Create the intent (the DECISION to inform) and dispatch it. Idempotent: the intent id is derived
// from the event, so a redelivered event finds it already there and does nothing. A duplicated
// notification is worse than a missing one — the member learns to ignore us.
export async function notify(
  deps: NotificationDeps,
  ctx: TenantContext,
  input: NotifyInput,
): Promise<Result<{ intentId: string; created: boolean }, DomainError>> {
  const existing = await deps.repo.getIntent(ctx, input.intentId)
  if (existing) return { ok: true, value: { intentId: existing.id, created: false } }

  const c = dctx(deps, ctx, input.operationId)
  const prefs =
    input.recipient.kind === 'member'
      ? await deps.loadPrefs(ctx, input.recipient.id)
      : DEFAULT_PREFS

  const dayStart = c.now - (c.now % 86_400_000)
  const sentToday = await deps.repo.countIntentsSince(ctx, dayStart)

  const decided = decideCreateIntent(c, {
    intentId: input.intentId,
    eventId: input.eventId,
    eventType: input.eventType,
    templateId: input.templateId,
    recipient: input.recipient,
    params: input.params,
    prefs,
    settings: deps.settings,
    sentToday,
  })
  if (!decided.ok) return decided

  await deps.repo.saveIntent(ctx, decided.value.intent, decided.value.events)
  await dispatch(deps, ctx, decided.value.intent)
  return { ok: true, value: { intentId: decided.value.intent.id, created: true } }
}

// Fan out to every channel the intent survived. Each channel is INDEPENDENT: one throwing does not
// stop the next, because the member who did not get the SMS still deserves the e-mail.
export async function dispatch(
  deps: NotificationDeps,
  ctx: TenantContext,
  intent: NotificationIntent,
): Promise<void> {
  const template = TEMPLATES[intent.templateId]
  if (!template) return
  const rendered = render(template, intent.params)
  if (!rendered.ok) return // refused at creation already; belt and braces

  const c = dctx(deps, ctx, intent.operationId)
  // Quiet hours (owner, decision 4): URGENT and HIGH never wait. A class cancelled for tomorrow
  // morning cannot sit in a queue until 08:00.
  const quiet =
    waitsForQuietHours(intent.priority) &&
    isQuietHour(c.now, deps.settings, deps.utcOffsetMinutes)

  for (const channel of intent.channels) {
    const created = newAttempt(c, intent, channel, rendered.value, quiet)
    await deps.repo.saveAttempt(ctx, created.attempt, created.events)
    if (quiet) continue // the retry sweep picks it up when the studio wakes
    await deliver(deps, ctx, intent, created.attempt)
  }
}

// One attempt, one provider, one recorded outcome. The provider's answer is EVIDENCE — this function
// records what WE believe happened, and a later callback may update it.
export async function deliver(
  deps: NotificationDeps,
  ctx: TenantContext,
  intent: NotificationIntent,
  attempt: DeliveryAttempt,
): Promise<void> {
  const provider = deps.providers.find((p) => p.channel === attempt.channel)
  const c = dctx(deps, ctx, intent.operationId)

  if (!provider) {
    // A channel with no provider is not a crash: it is a channel we have not built yet (SMS,
    // WhatsApp, push are PORTS in v1.25). Say so, in the record.
    const failed = decideAttemptResult(c, intent, attempt, {
      ok: false,
      code: 'no_provider',
      message: `channel ${attempt.channel} has no provider`,
      permanent: true,
    })
    await deps.repo.saveAttempt(ctx, failed.attempt, failed.events)
    return
  }

  const message: RenderedMessage = {
    to: {
      email: intent.recipient.email,
      phone: intent.recipient.phone,
      memberId: intent.recipient.kind === 'member' ? intent.recipient.id : null,
    },
    subject: attempt.subject ?? '',
    body: attempt.body ?? '',
    intentId: intent.id,
    channel: attempt.channel,
    // Carried through so a provider that cannot send free text (WhatsApp, outside its 24-hour
    // window) can send the APPROVED template instead — with the same values in it.
    templateId: intent.templateId,
    params: intent.params,
  }

  let result
  try {
    result = await provider.send(ctx, message)
  } catch (e) {
    // A provider that throws is a TRANSIENT failure unless it says otherwise — but a provider that
    // keeps throwing runs out of retries and stops, which is the point of the ceiling.
    result = {
      ok: false,
      providerRef: null,
      delivered: false,
      error: { code: 'provider_threw', message: String(e), permanent: false },
    }
  }

  const outcome = result.ok
    ? decideAttemptResult(c, intent, attempt, {
        ok: true,
        providerRef: result.providerRef,
        delivered: result.delivered,
      })
    : decideAttemptResult(c, intent, attempt, {
        ok: false,
        code: result.error?.code ?? 'unknown',
        message: result.error?.message ?? '',
        // When a provider will not tell us whether a failure is permanent, we treat it as permanent.
        // We do not spend money on a guess.
        permanent: result.error?.permanent ?? true,
      })

  await deps.repo.saveAttempt(ctx, outcome.attempt, outcome.events)
}

// The retry sweep. Queued attempts whose backoff has elapsed — and the quiet-hour queue, which is the
// same mechanism seen from a different angle.
export async function sweepRetries(
  deps: NotificationDeps,
  ctx: TenantContext,
): Promise<{ retried: number }> {
  const now = deps.clock.now()
  const due = await deps.repo.listDue(ctx, now)
  let retried = 0

  for (const attempt of due) {
    const intent = await deps.repo.getIntent(ctx, attempt.intentId)
    if (!intent || intent.cancelled) continue

    // Still inside quiet hours? Leave it queued — that is not a failure, it is the policy working.
    if (
      waitsForQuietHours(intent.priority) &&
      isQuietHour(instant(now), deps.settings, deps.utcOffsetMinutes)
    ) {
      continue
    }

    // A retry is a NEW attempt, never a mutation of the old one — the same discipline as a payment
    // void: history is appended to, never edited.
    const next = attempt.error ? retryOf(attempt) : { ...attempt, status: 'pending' as const }
    await deliver(deps, ctx, intent, next)
    retried++
  }
  return { retried }
}

// A derived, stable id: the same event + template + recipient always produces the same intent, so a
// redelivered trigger cannot notify twice.
export function intentIdFor(eventId: string, templateId: string, recipientId: string): string {
  const raw = `${eventId}|${templateId}|${recipientId}`
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0
  }
  return `ntf_${Math.abs(hash).toString(36)}_${templateId.slice(0, 12)}`
}

// Bulk acts collapse to ONE message per (recipient, operation, template): a closure that cancels
// twelve of her classes must not send twelve messages — and, at 0,15 ₺ an SMS, must not send twelve
// charges either.
export const collapsedIntentId = (
  operationId: string,
  templateId: string,
  recipientId: string,
): string => intentIdFor(operationId, templateId, recipientId)

export const channelsOf = (intent: NotificationIntent): readonly Channel[] => intent.channels

export const newIntentOperationId = newOperationId
