import { Timestamp } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'

import {
  collapsedIntentId,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PREFS,
  FirestoreEntitlementRepository,
  FirestoreIdentityRepository,
  FirestoreMemberRepository,
  FirestoreNotificationRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  ConsoleEmailProvider,
  InAppProvider,
  intentIdFor,
  notify,
  ResendEmailProvider,
  rulesFor,
  systemClock,
  WhatsAppProvider,
  type ClassSessionId,
  type MemberId,
  type NotificationDeps,
  type NotificationPrefs,
  type NotificationSettings,
  type NotificationProvider,
  type RecipientRef,
  type StudioId,
  type TenantContext,
} from '@studio/core'

import { db } from '../shared/firebase'

// ── EVENT → INTENT (v1.25, Doc 28 §9). ──────────────────────────────────────────────────────
//
// The second consumer of `onEventCreated` (the first is the daily projection). It reads a PURE rules
// table, resolves the recipient and her parameters FROM STATE — because the event carries no PII
// (#6) and a message needs a name, a class time and an address — and creates the intent.
//
// It never fails the write it is reading: the event is already committed and permanent, and a
// notification that cannot be created is a notification that did not go out, not a booking that did
// not happen.

const OFFSET_MIN = 180

/**
 * Real transport when the secret exists; the console recorder when it does not.
 *
 * A deployed environment WITHOUT a Resend key falls back to the console — and that would be a
 * studio telling its members "we e-mailed you" while nothing was e-mailed. So it is loud: the
 * fallback logs a warning on every construction, and the go/no-go checklist has a line that says a
 * real e-mail must have arrived in a real inbox before cutover.
 */
function emailProvider(): NotificationProvider {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (apiKey && from) return new ResendEmailProvider(apiKey, from)

  logger.warn('e-mail transport is the CONSOLE — no message will leave the building', {
    alert: 'email_transport_not_configured',
    hasApiKey: Boolean(apiKey),
    hasFrom: Boolean(from),
  })
  return new ConsoleEmailProvider()
}

/**
 * The studio's notification settings, from the settings screen (DEBT-024) — falling back to the
 * defaults only for a studio whose owner has not opened it yet.
 *
 * `in_app` is forced on regardless of what is stored. It is not a message; it is the member's record
 * of what happened to her account, and a settings document that had somehow lost it must not be able
 * to silence her own history.
 */
export async function studioNotificationSettings(studioId: StudioId): Promise<NotificationSettings> {
  const snap = await db().doc(`studios/${studioId}/settings/studio`).get()
  const stored = snap.get('notifications') as NotificationSettings | undefined
  if (!stored) return DEFAULT_NOTIFICATION_SETTINGS

  const channels = new Set(stored.enabledChannels ?? [])
  channels.add('in_app')
  return { ...stored, enabledChannels: [...channels] as NotificationSettings['enabledChannels'] }
}

export function notificationDeps(settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS): NotificationDeps {
  const database = db()
  return {
    repo: new FirestoreNotificationRepository(database),
    clock: systemClock,
    // v1.26 — the transport is real when it is CONFIGURED, and honest when it is not.
    //
    // With a Resend key, e-mail leaves the building. Without one, the console provider records the
    // attempt and logs the message — a deliberate DEVELOPMENT behaviour, never a production one.
    // The two are told apart by the secret's presence, not by a flag somebody must remember to
    // flip: a studio cannot go live telling members "we e-mailed you" while nothing was e-mailed,
    // and the go/no-go checklist has a line for exactly this.
    //
    // WhatsApp is wired as a MOCK: the pipeline — intent, attempt, retry, quiet hours, the
    // Notification Center — is proven end to end without a Meta contract, a verified number, or an
    // approved template. Handing it the real transport is one constructor argument (owner: stop and
    // ask when a production credential is needed).
    providers: [
      new InAppProvider(database),
      emailProvider(),
      new WhatsAppProvider(), // mock until Meta credentials exist
    ],
    settings,
    utcOffsetMinutes: OFFSET_MIN,
    loadPrefs: async (ctx, memberId): Promise<NotificationPrefs> => {
      const snap = await database.doc(`studios/${ctx.studioId}/members/${memberId}`).get()
      return { ...DEFAULT_PREFS, ...((snap.get('notificationPrefs') as NotificationPrefs) ?? {}) }
    },
  }
}

interface EventLike {
  readonly id: string
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly related: { memberId?: string; classSessionId?: string; entitlementId?: string }
  readonly correlationId: string
  readonly occurredAt: number
}

export async function notifyForEvent(studioId: StudioId, event: EventLike): Promise<number> {
  const rules = rulesFor(event.type)
  if (rules.length === 0) return 0

  const deps = notificationDeps(await studioNotificationSettings(studioId))
  const ctx: TenantContext = {
    studioId,
    branchIds: [],
    role: 'owner',
    // The notifier is a `system` principal — it never borrows the human whose act triggered it (#5).
    actor: { type: 'system', id: 'notification_dispatcher' as never },
  }

  let created = 0
  for (const rule of rules) {
    const recipients = await resolveRecipients(ctx, rule.to, event)
    for (const recipient of recipients) {
      const params = await resolveParams(ctx, event, recipient)
      if (!params) continue

      // Bulk acts collapse to ONE message per (recipient, operation, template): a closure that
      // cancels twelve of her classes must not send twelve messages — and, at 0,15 ₺ an SMS, must
      // not send twelve charges either.
      const intentId = rule.collapseByOperation
        ? collapsedIntentId(event.correlationId, rule.template, recipient.id)
        : intentIdFor(event.id, rule.template, recipient.id)

      const res = await notify(deps, ctx, {
        intentId,
        eventId: event.id,
        eventType: event.type,
        operationId: event.correlationId,
        templateId: rule.template,
        recipient,
        params,
      })
      if (res.ok && res.value.created) created++
      if (!res.ok) {
        // The daily ceiling tripping is not a bug — it is the ceiling working. It must be LOUD.
        logger.warn('notification not created', { type: event.type, error: res.error.code })
      }
    }
  }
  return created
}

async function resolveRecipients(
  ctx: TenantContext,
  audience: string,
  event: EventLike,
): Promise<readonly RecipientRef[]> {
  const database = db()
  const members = new FirestoreMemberRepository(database)

  if (audience === 'member') {
    const id = event.related.memberId
    if (!id) return []
    const m = await members.findById(ctx, id as MemberId)
    return m ? [memberRef(m)] : []
  }

  // The studio cancelled a class: everyone booked into it is told. This is the fan-out that makes
  // `class_session.cancelled` worth an URGENT priority.
  if (audience === 'roster') {
    const sessionId = event.related.classSessionId
    if (!sessionId) return []
    const roster = await new FirestoreReservationRepository(database).listBySession(
      ctx,
      sessionId as ClassSessionId,
    )
    const ids = [...new Set(roster.filter((r) => r.status === 'booked').map((r) => r.memberId as string))]
    const rows = await Promise.all(ids.map((id) => members.findById(ctx, id as MemberId)))
    return rows.filter(Boolean).map((m) => memberRef(m!))
  }

  // Staff alerts (owner, decision 6). Today NOTHING tells the owner when an operation fails; this is
  // half of this milestone, not an afterthought.
  const staff = await new FirestoreIdentityRepository(database).listStaff(ctx)
  const wanted = audience === 'owner' ? 'owner' : 'receptionist'
  return staff
    .filter((s) => s.active && s.role === wanted)
    .map((s) => ({
      kind: 'staff' as const,
      id: s.id as string,
      email: null, // staff e-mail arrives with v1.31 Staff & Identity; in-app reaches them today
      phone: null,
      displayName: s.displayName,
    }))
}

const memberRef = (m: {
  id: unknown
  fullName: string
  email?: string | null
  phone: unknown
}): RecipientRef => ({
  kind: 'member',
  id: m.id as string,
  email: (m.email as string | null) ?? null,
  phone: (m.phone as string) ?? null,
  displayName: m.fullName,
})

// The params come from STATE, never from the event — the event has no name, no class time and no
// amount in lira. This is where identity and behaviour finally meet, and it is the only place they do.
async function resolveParams(
  ctx: TenantContext,
  event: EventLike,
  recipient: RecipientRef,
): Promise<Record<string, string> | null> {
  const database = db()
  const p = event.payload
  const dt = (ms: number): string =>
    new Date(ms).toLocaleString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const tl = (v: unknown): string => {
    const amount =
      v && typeof v === 'object' && 'amount' in v ? ((v as { amount: number }).amount ?? 0) : 0
    return `${(amount / 100).toLocaleString('tr-TR')} ₺`
  }

  const base = { memberName: recipient.displayName }

  switch (event.type) {
    case 'reservation.booked':
    case 'reservation.cancelled':
    case 'waitlist.promoted':
    case 'class_session.cancelled': {
      const sessionId = event.related.classSessionId
      if (!sessionId) return null
      const session = await new FirestoreSchedulingRepository(database).getSession(
        ctx,
        sessionId as ClassSessionId,
      )
      if (!session) return null
      return { ...base, sessionName: session.serviceName, sessionTime: dt(session.startsAt) }
    }
    case 'reservation.moved':
      return {
        ...base,
        fromTime: dt(Number(p.fromStartsAt ?? 0)),
        toTime: dt(Number(p.toStartsAt ?? 0)),
      }
    case 'studio_closure.applied':
      return {
        ...base,
        reason: String(p.reason ?? 'Kapanış'),
        sessionCount: String(p.sessionsCancelled ?? 0),
      }
    case 'entitlement.purchased': {
      const entitlementId = event.related.entitlementId
      if (!entitlementId) return null
      const ent = await new FirestoreEntitlementRepository(database).getEntitlement(
        ctx,
        entitlementId as never,
      )
      return ent ? { ...base, productName: ent.productSnapshot.name } : null
    }
    case 'entitlement.expiring':
      return { ...base, productName: String(p.productName ?? 'Üyeliğiniz'), daysLeft: String(p.daysLeft ?? 0) }
    case 'entitlement.credits_low':
      return { ...base, remaining: String(p.remaining ?? 0) }
    case 'entitlement.exhausted':
      return base
    case 'payment.received':
      return { ...base, amount: tl(p.amount) }
    case 'plan.instalment_due':
      return { ...base, amount: tl(p.amount), dueDate: dt(Number(p.dueAt ?? 0)) }
    case 'member.invited':
      return { ...base, inviteLink: String(p.inviteUrl ?? '/portal/login') }
    case 'drawer.discrepancy_recorded':
      return { drawerName: String(p.drawerName ?? 'Kasa'), discrepancy: tl(p.discrepancy) }
    case 'system.operation_failed':
    case 'system.error':
      return { detail: String(p.detail ?? 'Ayrıntı yok') }
    case 'notification.failed':
      return {
        memberName: recipient.displayName,
        channel: String(p.channel ?? ''),
        reason: String(p.errorCode ?? ''),
      }
    default:
      return null
  }
}

export const toEventLike = (id: string, data: Record<string, unknown>): EventLike => ({
  id,
  type: data.type as string,
  payload: (data.payload ?? {}) as Record<string, unknown>,
  related: (data.related ?? {}) as EventLike['related'],
  correlationId: (data.correlationId as string) ?? '',
  occurredAt: data.occurredAt instanceof Timestamp ? data.occurredAt.toMillis() : 0,
})
