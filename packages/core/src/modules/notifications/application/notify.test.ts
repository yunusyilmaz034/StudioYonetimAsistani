import { describe, expect, it } from 'vitest'

import { dispatch } from './notify'
import type { NotificationDeps, NotificationProvider, NotificationRepository } from './ports'
import { decideCreateIntent, type DecideContext } from '../domain/decide'
import { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_PREFS, type DeliveryAttempt, type NotificationIntent, type RecipientRef } from '../domain/types'
import { instant, type ActorRef, type Clock, type CorrelationId, type StaffUserId, type StudioId, type TenantContext } from '../../../shared'

// Regression: a LOW-priority message sent DURING quiet hours must still land in the in-app inbox
// immediately — only the intrusive channels wait. This is the "Yeni bir hafta, yeni bir sen" bug:
// an engagement broadcast sent at 01:30 sat queued and was invisible in the member's inbox all night.

const ACTOR: ActorRef = { type: 'receptionist', id: 'usr_1' as StaffUserId }
const dctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: ACTOR,
  now: instant(0),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const member: RecipientRef = { kind: 'member', id: 'mem_1', email: 'a@example.com', phone: '+905551112233', displayName: 'Ayşe' }

// 01:00 with a zero UTC offset → inside the default 22:00–08:00 quiet window.
const QUIET_HOUR_MS = 3_600_000

function lowPriorityIntent(channels: readonly DeliveryAttempt['channel'][]): NotificationIntent {
  const r = decideCreateIntent(dctx, {
    intentId: 'ntf_1',
    eventId: 'evt_1',
    eventType: 'engagement.broadcast',
    templateId: 'booking_confirmed',
    recipient: member,
    params: { memberName: 'Ayşe', sessionName: 'Reformer', sessionTime: '20.07.2026 09:00' },
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    sentToday: 0,
  })
  if (!r.ok) throw new Error('fixture')
  return { ...r.value.intent, priority: 'low', channels }
}

function harness() {
  const saved: DeliveryAttempt[] = []
  const repo = {
    saveAttempt: async (_ctx: TenantContext, a: DeliveryAttempt) => { saved.push(a) },
    // Unused by dispatch(); present to satisfy the port.
    getIntent: async () => null,
    listIntents: async () => [],
    saveIntent: async () => {},
    getAttempt: async () => null,
    listAttempts: async () => [],
    listAttemptsByIntent: async () => [],
    listDue: async () => [],
    countIntentsSince: async () => 0,
    pushInbox: async () => {},
    listInbox: async () => [],
    markInboxRead: async () => {},
  } as unknown as NotificationRepository

  const inApp: NotificationProvider = {
    channel: 'in_app',
    send: async () => ({ ok: true, providerRef: null, delivered: true }),
  }
  const email: NotificationProvider = {
    channel: 'email',
    send: async () => ({ ok: true, providerRef: 'e1', delivered: false }),
  }
  const clock: Clock = { now: () => instant(QUIET_HOUR_MS) }
  const deps: NotificationDeps = {
    repo,
    clock,
    providers: [inApp, email],
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    utcOffsetMinutes: 0,
    loadPrefs: async () => DEFAULT_PREFS,
  }
  const ctx = { studioId: 'std_1' as StudioId, actor: ACTOR } as unknown as TenantContext
  return { deps, ctx, saved }
}

describe('dispatch — quiet hours never hold the in-app inbox', () => {
  it('delivers in_app immediately at 01:00 while email waits (queued)', async () => {
    const { deps, ctx, saved } = harness()
    await dispatch(deps, ctx, lowPriorityIntent(['in_app', 'email']))

    const inAppStates = saved.filter((a) => a.channel === 'in_app').map((a) => a.status)
    const emailStates = saved.filter((a) => a.channel === 'email').map((a) => a.status)

    // in_app is NEVER queued — it starts pending and is delivered by its provider.
    expect(inAppStates).not.toContain('queued')
    expect(inAppStates.at(-1)).toBe('delivered')
    // email is intrusive: it waits for the morning sweep.
    expect(emailStates).toEqual(['queued'])
  })

  it('an in_app-only low-priority message is never left queued at night', async () => {
    const { deps, ctx, saved } = harness()
    await dispatch(deps, ctx, lowPriorityIntent(['in_app']))
    expect(saved.some((a) => a.status === 'queued')).toBe(false)
    expect(saved.at(-1)?.status).toBe('delivered')
  })
})
