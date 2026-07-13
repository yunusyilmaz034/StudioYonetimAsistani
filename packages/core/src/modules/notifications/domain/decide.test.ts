import { describe, expect, it } from 'vitest'

import {
  decideAttemptResult,
  decideCreateIntent,
  isQuietHour,
  newAttempt,
  render,
  retryOf,
  selectChannels,
  waitsForQuietHours,
  type DecideContext,
} from './decide'
import { TEMPLATES } from './templates'
import { rulesFor } from './rules'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PREFS,
  type DeliveryAttempt,
  type NotificationIntent,
  type RecipientRef,
} from './types'
import { instant, type ActorRef, type CorrelationId, type StaffUserId, type StudioId } from '../../../shared'

const NOW = instant(1_700_000_000_000)
const ACTOR: ActorRef = { type: 'receptionist', id: 'usr_1' as StaffUserId }
const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: ACTOR,
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const member: RecipientRef = {
  kind: 'member',
  id: 'mem_1',
  email: 'ayse@example.com',
  phone: '+905551112233',
  displayName: 'Ayşe Yılmaz',
}

const input = (over: Partial<Parameters<typeof decideCreateIntent>[1]> = {}) => ({
  intentId: 'ntf_1',
  eventId: 'evt_1',
  eventType: 'reservation.booked',
  templateId: 'booking_confirmed',
  recipient: member,
  params: { memberName: 'Ayşe', sessionName: 'Reformer Pilates', sessionTime: '14.07.2026 09:00' },
  prefs: DEFAULT_PREFS,
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  sentToday: 0,
  ...over,
})

describe('templates & rendering (v1.25)', () => {
  it('renders Turkish sentences with no technical event name and no leftover placeholder', () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(t.body).not.toMatch(/[a-z_]+\.[a-z_]+/) // no `reservation.booked` leaking into copy
      expect(t.body.length).toBeGreaterThan(10)
    }
    const r = render(TEMPLATES.booking_confirmed!, {
      memberName: 'Ayşe',
      sessionName: 'Reformer',
      sessionTime: 'yarın 09:00',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body).toBe('Merhaba Ayşe, yarın 09:00 tarihindeki Reformer dersiniz için rezervasyonunuz oluşturuldu.')
  })

  it('REFUSES to render a template with a missing param — we would rather send nothing than "Merhaba {{memberName}}"', () => {
    const r = render(TEMPLATES.booking_confirmed!, { memberName: 'Ayşe' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('template_params_missing')
  })

  it('every rule points at a template that exists', () => {
    const referenced = Object.values({ ...TEMPLATES }).length
    expect(referenced).toBeGreaterThan(0)
    for (const type of ['reservation.booked', 'class_session.cancelled', 'drawer.discrepancy_recorded']) {
      for (const rule of rulesFor(type)) {
        expect(TEMPLATES[rule.template], `${type} → ${rule.template}`).toBeDefined()
      }
    }
  })
})

describe('channel selection — the KVKK line and the preference line (v1.25)', () => {
  it('in_app can NEVER be turned off: it is her record, not a message', () => {
    const d = selectChannels(
      member,
      { email: false, sms: false, whatsapp: false, push: false },
      DEFAULT_NOTIFICATION_SETTINGS,
      'operational',
    )
    expect(d.channels).toEqual(['in_app'])
    expect(d.suppressed).toEqual([{ channel: 'email', reason: 'member_preference' }])
  })

  it('a marketing message is SUPPRESSED on every external channel — there is no consent surface yet', () => {
    const d = selectChannels(member, DEFAULT_PREFS, DEFAULT_NOTIFICATION_SETTINGS, 'marketing')
    expect(d.channels).toEqual(['in_app'])
    expect(d.suppressed).toEqual([{ channel: 'email', reason: 'no_consent' }])
  })

  it('a member with no e-mail on file is suppressed BY NAME, not silently dropped', () => {
    const d = selectChannels({ ...member, email: null }, DEFAULT_PREFS, DEFAULT_NOTIFICATION_SETTINGS, 'operational')
    expect(d.channels).toEqual(['in_app'])
    expect(d.suppressed).toEqual([{ channel: 'email', reason: 'missing_contact' }])
  })
})

describe('quiet hours — priority decides (owner, decision 4)', () => {
  const at = (hourLocal: number) => instant(hourLocal * 3_600_000 - 180 * 60_000)

  it('23:00 is quiet, 09:00 is not', () => {
    expect(isQuietHour(at(23), DEFAULT_NOTIFICATION_SETTINGS, 180)).toBe(true)
    expect(isQuietHour(at(2), DEFAULT_NOTIFICATION_SETTINGS, 180)).toBe(true)
    expect(isQuietHour(at(9), DEFAULT_NOTIFICATION_SETTINGS, 180)).toBe(false)
  })

  it('URGENT and HIGH never wait; LOW and NORMAL do', () => {
    expect(waitsForQuietHours('urgent')).toBe(false) // "yarınki dersiniz iptal edildi" cannot wait
    expect(waitsForQuietHours('high')).toBe(false)
    expect(waitsForQuietHours('normal')).toBe(true)
    expect(waitsForQuietHours('low')).toBe(true)
  })
})

describe('intent (v1.25)', () => {
  it('creates an intent and writes NO body and NO address into the event (I-38)', () => {
    const r = decideCreateIntent(ctx, input())
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const payload = JSON.stringify(r.value.events[0]?.payload)
    expect(payload).not.toContain('Merhaba')
    expect(payload).not.toContain('ayse@example.com')
    expect(payload).not.toContain('905551112233')
    expect(r.value.events[0]?.payload).toMatchObject({
      templateId: 'booking_confirmed',
      channels: ['in_app', 'email'],
      recipientKind: 'member',
    })
    // …while the intent itself DOES carry them: identity and behaviour meet here, and here only.
    expect(r.value.intent.recipient.phone).toBe('+905551112233')
  })

  it('the daily ceiling stops creating intents — a runaway loop costs a warning, not a month of revenue', () => {
    const r = decideCreateIntent(ctx, input({ sentToday: 1000 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('daily_limit_reached')
  })

  it('a suppression is an EVENT — a silent suppression is indistinguishable from a bug', () => {
    const r = decideCreateIntent(
      ctx,
      input({ prefs: { ...DEFAULT_PREFS, email: false } }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events.map((e) => e.type)).toEqual([
      'notification.intent_created',
      'notification.suppressed',
    ])
    expect(r.value.events[1]?.payload).toMatchObject({ channel: 'email', reason: 'member_preference' })
  })
})

describe('delivery attempts (v1.25)', () => {
  const intent = (): NotificationIntent => {
    const r = decideCreateIntent(ctx, input())
    if (!r.ok) throw new Error('fixture')
    return r.value.intent
  }
  const attempt = (over: Partial<DeliveryAttempt> = {}): DeliveryAttempt => ({
    ...newAttempt(ctx, intent(), 'email', { subject: 's', body: 'b' }, false).attempt,
    ...over,
  })

  it('in_app is DELIVERED when it succeeds — it is a write to our own database', () => {
    const r = decideAttemptResult(ctx, intent(), attempt({ channel: 'in_app' }), {
      ok: true,
      providerRef: null,
      delivered: true,
    })
    expect(r.attempt.status).toBe('delivered')
    expect(r.events[0]?.type).toBe('notification.delivered')
  })

  it('a TRANSIENT failure queues a retry with a backoff', () => {
    const r = decideAttemptResult(ctx, intent(), attempt(), {
      ok: false,
      code: 'smtp_timeout',
      message: 'timeout',
      permanent: false,
    })
    expect(r.attempt.status).toBe('queued')
    expect(r.attempt.nextRetryAt).toBe(NOW + 5 * 60_000) // e-mail's first backoff, from DATA
    expect(retryOf(r.attempt).attemptNo).toBe(2)
  })

  it('a PERMANENT failure is never retried — an invalid address is still invalid in an hour', () => {
    const r = decideAttemptResult(ctx, intent(), attempt(), {
      ok: false,
      code: 'invalid_address',
      message: 'no such mailbox',
      permanent: true,
    })
    expect(r.attempt.status).toBe('failed')
    expect(r.attempt.nextRetryAt).toBeNull()
    expect(r.events[0]?.payload).toMatchObject({ errorCode: 'invalid_address', permanent: true })
    // and the failure event carries NO message body and NO address
    expect(JSON.stringify(r.events[0]?.payload)).not.toContain('mailbox')
  })

  it('runs out of retries and fails for good', () => {
    const r = decideAttemptResult(ctx, intent(), attempt({ attemptNo: 3 }), {
      ok: false,
      code: 'smtp_timeout',
      message: 'timeout',
      permanent: false,
    })
    expect(r.attempt.status).toBe('failed') // e-mail: maxAttempts = 3
  })
})
