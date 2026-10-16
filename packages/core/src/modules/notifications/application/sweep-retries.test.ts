import { describe, expect, it } from 'vitest'

import { dispatch, sweepRetries } from './notify'
import type { NotificationDeps, NotificationProvider, NotificationRepository } from './ports'
import { decideCreateIntent, type DecideContext } from '../domain/decide'
import { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_PREFS, type DeliveryAttempt, type NotificationIntent } from '../domain/types'
import { instant, type ActorRef, type CorrelationId, type StaffUserId, type StudioId, type TenantContext } from '../../../shared'

// Regression (owner, 2026-10-16): a failed attempt stayed `queued` after its retry was made, so every
// sweep retried it AGAIN — 24 dead-token pushes from September became ~1,000 "iletilemedi" alerts a
// day and used up the studio's whole daily ceiling. A failing push must fail at most `maxAttempts`
// times, however many sweeps run.

const ACTOR: ActorRef = { type: 'receptionist', id: 'usr_1' as StaffUserId }
const NOON = 12 * 3_600_000 // outside quiet hours with a zero UTC offset
const MIN = 60_000

function intentAt(createdAt: number): NotificationIntent {
  const c: DecideContext = { studioId: 'std_1' as StudioId, actor: ACTOR, now: instant(createdAt), correlationId: 'cor_1' as CorrelationId, source: 'reception_web' }
  const r = decideCreateIntent(c, {
    intentId: 'ntf_1',
    eventId: 'evt_1',
    eventType: 'engagement.broadcast',
    templateId: 'booking_confirmed',
    recipient: { kind: 'member', id: 'mem_1', email: null, phone: null, displayName: 'Ayşe' },
    params: { memberName: 'Ayşe', sessionName: 'Reformer', sessionTime: '20.07.2026 09:00' },
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    sentToday: 0,
  })
  if (!r.ok) throw new Error('fixture')
  return { ...r.value.intent, priority: 'high', channels: ['push'] }
}

function harness(intent: NotificationIntent) {
  let now = intent.createdAt as number
  const attempts = new Map<string, DeliveryAttempt>()
  let failedEvents = 0
  let sends = 0
  const repo = {
    saveAttempt: async (_c: TenantContext, a: DeliveryAttempt, events: readonly { type: string }[]) => {
      attempts.set(a.id, a)
      failedEvents += events.filter((e) => e.type === 'notification.failed').length
    },
    getIntent: async () => intent,
    listDue: async (_c: TenantContext, at: number) =>
      [...attempts.values()].filter((a) => a.status === 'queued' && (a.nextRetryAt === null || a.nextRetryAt <= at)),
  } as unknown as NotificationRepository
  const push: NotificationProvider = {
    channel: 'push',
    send: async () => { sends++; return { ok: false, providerRef: null, delivered: false, error: { code: 'push_rejected', message: 'Expo rejected all tokens', permanent: false } } },
  }
  const deps: NotificationDeps = {
    repo,
    clock: { now: () => instant(now) },
    providers: [push],
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    utcOffsetMinutes: 0,
    loadPrefs: async () => DEFAULT_PREFS,
  }
  const ctx = { studioId: 'std_1' as StudioId, actor: ACTOR } as unknown as TenantContext
  return {
    deps, ctx, attempts,
    advance: (ms: number) => { now += ms },
    stats: () => ({ failedEvents, sends }),
  }
}

describe('sweepRetries — a failed attempt is retried once, never again', () => {
  it('a push that keeps failing fails exactly maxAttempts (3) times across many sweeps', async () => {
    const h = harness(intentAt(NOON))
    await dispatch(h.deps, h.ctx, intentAt(NOON))
    for (let i = 0; i < 20; i++) {
      h.advance(5 * MIN)
      await sweepRetries(h.deps, h.ctx)
    }
    expect(h.stats()).toEqual({ failedEvents: 3, sends: 3 })
    expect([...h.attempts.values()].every((a) => a.status === 'failed')).toBe(true)
  })

  it('the retried attempt is closed, not left queued', async () => {
    const h = harness(intentAt(NOON))
    await dispatch(h.deps, h.ctx, intentAt(NOON))
    h.advance(2 * MIN)
    await sweepRetries(h.deps, h.ctx)
    const first = [...h.attempts.values()].find((a) => a.attemptNo === 1)
    expect(first?.status).toBe('failed')
  })

  it('a retry still due a day after its message is closed without sending (yesterday\'s news)', async () => {
    const h = harness(intentAt(NOON))
    await dispatch(h.deps, h.ctx, intentAt(NOON))
    h.advance(25 * 3_600_000)
    await sweepRetries(h.deps, h.ctx)
    expect(h.stats()).toEqual({ failedEvents: 1, sends: 1 })
    expect([...h.attempts.values()].every((a) => a.status === 'failed')).toBe(true)
  })

  it('a retry just inside the day is still sent', async () => {
    const h = harness(intentAt(NOON))
    await dispatch(h.deps, h.ctx, intentAt(NOON))
    h.advance(24 * 3_600_000 - MIN)
    await sweepRetries(h.deps, h.ctx)
    expect(h.stats().sends).toBe(2)
  })
})
