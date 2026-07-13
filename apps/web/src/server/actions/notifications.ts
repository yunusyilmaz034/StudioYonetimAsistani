'use server'

import {
  ConsoleEmailProvider,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PREFS,
  deliver,
  FirestoreNotificationRepository,
  InAppProvider,
  systemClock,
  TEMPLATES,
  type NotificationDeps,
  type NotificationPrefs,
} from '@studio/core'
import { z } from 'zod'

import { requireMemberContext, requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// The Notification Center is never a "send an SMS" screen (owner). It is the centre of Intent ·
// Queue · Attempt · Delivery · Retry · Audit — the record of who we tried to reach, how it went, and
// what we chose not to send.
const STAFF = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const

const deps = (): NotificationDeps => {
  const db = adminDb()
  return {
    repo: new FirestoreNotificationRepository(db),
    clock: systemClock,
    providers: [new InAppProvider(db), new ConsoleEmailProvider()],
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    utcOffsetMinutes: 180,
    loadPrefs: async (ctx, memberId) => {
      const snap = await db.doc(`studios/${ctx.studioId}/members/${memberId}`).get()
      return { ...DEFAULT_PREFS, ...((snap.get('notificationPrefs') as NotificationPrefs) ?? {}) }
    },
  }
}

export interface NotificationRow {
  readonly attemptId: string
  readonly intentId: string
  readonly templateName: string
  readonly recipientName: string
  readonly recipientKind: string
  readonly channel: string
  readonly status: string
  readonly attemptNo: number
  readonly errorCode: string | null
  readonly permanent: boolean
  readonly suppression: string | null
  readonly at: number
  readonly operationId: string
  readonly causedBy: string
  readonly subject: string | null
}

// Everything the owner asked for on one row: message · recipient · channel · time · what triggered
// it · status · error · retries · OperationId.
export async function listNotificationsAction(): Promise<readonly NotificationRow[]> {
  const ctx = await requireTenantContext(STAFF)
  const repo = new FirestoreNotificationRepository(adminDb())

  const [attempts, intents] = await Promise.all([repo.listAttempts(ctx, 200), repo.listIntents(ctx, 200)])
  const byId = new Map(intents.map((i) => [i.id, i]))

  return attempts
    .map((a) => {
      const intent = byId.get(a.intentId)
      return {
        attemptId: a.id,
        intentId: a.intentId,
        templateName: TEMPLATES[intent?.templateId ?? '']?.name ?? (intent?.templateId ?? '—'),
        recipientName: intent?.recipient.displayName ?? '—',
        recipientKind: intent?.recipient.kind ?? '—',
        channel: a.channel,
        status: a.status,
        attemptNo: a.attemptNo,
        errorCode: a.error?.code ?? null,
        permanent: a.error?.permanent ?? false,
        suppression: a.suppression,
        at: (a.sentAt ?? a.queuedAt ?? intent?.createdAt ?? 0) as number,
        operationId: intent?.operationId ?? '',
        causedBy: intent?.eventType ?? '',
        subject: a.subject,
      }
    })
    .sort((x, y) => y.at - x.at)
}

// Sometimes the answer to a failed delivery is a human deciding to try again. Owner only, and it is
// a new attempt — never an edit of the old one.
export async function resendNotificationAction(input: unknown) {
  const p = z.object({ attemptId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const repo = new FirestoreNotificationRepository(adminDb())

  const attempt = await repo.getAttempt(ctx, p.attemptId)
  if (!attempt) return { ok: false as const, error: { code: 'notification_not_found' as const } }
  const intent = await repo.getIntent(ctx, attempt.intentId)
  if (!intent) return { ok: false as const, error: { code: 'notification_not_found' as const } }

  await deliver(deps(), ctx, intent, {
    ...attempt,
    id: `${attempt.intentId}:${attempt.channel}:${attempt.attemptNo + 1}`,
    attemptNo: attempt.attemptNo + 1,
    status: 'pending',
    error: null,
    nextRetryAt: null,
  })
  return { ok: true as const, value: undefined }
}

// ── the member's own inbox (the one channel she cannot switch off — it is her record) ────────
export async function myInboxAction() {
  const { ctx, memberId } = await requireMemberContext()
  return new FirestoreNotificationRepository(adminDb()).listInbox(ctx, memberId as string)
}

export async function markInboxReadAction(input: unknown) {
  const p = z.object({ intentId: z.string().min(1) }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  await new FirestoreNotificationRepository(adminDb()).markInboxRead(ctx, memberId as string, p.intentId)
  return { ok: true as const }
}

// Her channel preferences. She may say "not by e-mail". She may NOT say "never tell me my class was
// cancelled" — which is why `in_app` is not on this list.
export async function setPrefsAction(input: unknown) {
  const p = z
    .object({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), push: z.boolean() })
    .parse(input)
  const { ctx, memberId } = await requireMemberContext()
  await adminDb()
    .doc(`studios/${ctx.studioId}/members/${memberId}`)
    .set({ notificationPrefs: p }, { merge: true })
  return { ok: true as const }
}

export async function myPrefsAction(): Promise<NotificationPrefs> {
  const { ctx, memberId } = await requireMemberContext()
  const snap = await adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`).get()
  return { ...DEFAULT_PREFS, ...((snap.get('notificationPrefs') as NotificationPrefs) ?? {}) }
}
