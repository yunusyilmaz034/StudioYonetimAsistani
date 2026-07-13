import { describe, expect, it } from 'vitest'

import { instant, type CorrelationId, type StudioId } from '../../../shared'
import { decideUpdateStudioSettings } from './decide'
import type { StudioSettings } from './types'

// Studio settings, and the split that is the whole design (v1.27 S2 · owner, 2026-07-13):
//
//   • a setting that changes a DOMAIN DECISION is logged with its previous AND new values
//   • a setting that is CONFIGURATION is logged as a field NAME only
//
// The first is because a member who booked under a six-hour window and was judged under a
// twelve-hour one deserves an answer, and *"we changed it at some point"* is not one.
// The second is because a tax number, an address and a phone are business PII, and the log is
// permanent.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_1' as never },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

const settings = (over: Partial<StudioSettings> = {}): StudioSettings => ({
  studioId: 'std_1' as StudioId,
  defaultCancellationWindowHours: 6,
  lowCreditThreshold: 2,
  discountCeilingPercent: 20,
  defaultSessionDurationMinutes: 50,
  timeZone: 'Europe/Istanbul',
  company: null,
  workingHours: null,
  qr: null,
  notifications: null,
  ...over,
})

const COMPANY = {
  legalName: 'Işıl Pilates Ltd. Şti.',
  displayName: 'Pilates Fitness by Işıl',
  taxOffice: 'Beşiktaş',
  taxNumber: '1234567890',
  phone: '+902121234567',
  email: 'info@studio.test',
  website: null,
  address: 'Barbaros Bulvarı No:1, Beşiktaş, İstanbul',
}

describe('a rule change is logged with the value it REPLACED', () => {
  it('carries previous → new for the cancellation window', () => {
    const r = decideUpdateStudioSettings(ctx, settings(), settings({ defaultCancellationWindowHours: 12 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const p = r.value[0]?.payload as Record<string, unknown>
    expect(p.changedFields).toEqual(['defaultCancellationWindowHours'])
    // Without BOTH, a dispute about a class booked last March cannot be settled. A rule that cannot
    // be reconstructed cannot be defended.
    expect(p.defaultCancellationWindowHours).toBe(12)
    expect(p.previousDefaultCancellationWindowHours).toBe(6)
  })

  it('does the same for the discount ceiling, the low-credit threshold and the default duration', () => {
    const r = decideUpdateStudioSettings(
      ctx,
      settings(),
      settings({ discountCeilingPercent: 30, lowCreditThreshold: 3, defaultSessionDurationMinutes: 55 }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const p = r.value[0]?.payload as Record<string, unknown>
    expect(p.previousDiscountCeilingPercent).toBe(20)
    expect(p.discountCeilingPercent).toBe(30)
    expect(p.previousLowCreditThreshold).toBe(2)
    expect(p.previousDefaultSessionDurationMinutes).toBe(50)
  })
})

describe('configuration is logged as a NAME, and never as a value', () => {
  it('records that the company changed — and not one character of what it says', () => {
    const r = decideUpdateStudioSettings(ctx, settings(), settings({ company: COMPANY }))
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const payload = r.value[0]?.payload as Record<string, unknown>
    expect(payload.changedFields).toEqual(['company'])

    // The tax number, the address, the phone. The log is permanent, and none of them belong in it —
    // the same discipline as `member.profile_updated` (AD-25): *which* fields changed, never *to what*.
    const json = JSON.stringify(payload)
    expect(json).not.toContain('1234567890')
    expect(json).not.toContain('Barbaros')
    expect(json).not.toContain('+90212')
    expect(json).not.toContain('Işıl')
  })

  it('records working hours and QR the same way', () => {
    const r = decideUpdateStudioSettings(
      ctx,
      settings(),
      settings({
        workingHours: {
          0: null,
          1: { open: '10:00', close: '21:00' },
          2: null,
          3: null,
          4: null,
          5: null,
          6: { open: '11:00', close: '17:00' },
        },
        qr: { tokenTtlSeconds: 90, checkInWindowMinutes: 30 },
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const payload = r.value[0]?.payload as Record<string, unknown>
    expect(payload.changedFields).toEqual(['workingHours', 'qr'])
    expect(JSON.stringify(payload)).not.toContain('10:00')
  })
})

describe('what it refuses', () => {
  it('refuses a day that closes before it opens — a typo, not a short day', () => {
    // Silently accepted, it would make every hour of that day invalid, and nobody would know why.
    const r = decideUpdateStudioSettings(
      ctx,
      settings(),
      settings({
        workingHours: {
          0: null,
          1: { open: '21:00', close: '10:00' },
          2: null,
          3: null,
          4: null,
          5: null,
          6: null,
        },
      }),
    )
    expect(r).toEqual({ ok: false, error: { code: 'invalid_time_range' } })
  })

  it('refuses a QR token that never expires, and a negative cancellation window', () => {
    expect(
      decideUpdateStudioSettings(ctx, settings(), settings({ qr: { tokenTtlSeconds: 0, checkInWindowMinutes: 30 } })).ok,
    ).toBe(false)
    expect(
      decideUpdateStudioSettings(ctx, settings(), settings({ defaultCancellationWindowHours: -1 })).ok,
    ).toBe(false)
  })
})

describe('saving an unchanged form is not an act', () => {
  it('emits NOTHING — the audit must not fill up with "the owner opened settings and left"', () => {
    const r = decideUpdateStudioSettings(ctx, settings(), settings())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual([])
  })

  it('a first-ever save records every field that is now set', () => {
    // A studio being provisioned: `current` is null, because nobody has ever opened this screen.
    const r = decideUpdateStudioSettings(ctx, null, settings({ company: COMPANY }))
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const p = r.value[0]?.payload as { changedFields: string[] }
    expect(p.changedFields).toContain('company')
    expect(p.changedFields).toContain('defaultCancellationWindowHours')
    expect(p.changedFields).toContain('timeZone')
  })
})

// DEBT-024 — the notification settings the owner can finally change without a deploy.
describe('notification settings', () => {
  const NOTIF = {
    dailyLimit: 500,
    quietFromHour: 23,
    quietToHour: 7,
    enabledChannels: ['in_app', 'email'],
  }

  it('is CONFIGURATION — the log records that it changed, and not one of its values', () => {
    const r = decideUpdateStudioSettings(ctx, settings(), settings({ notifications: NOTIF }))
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const payload = r.value[0]?.payload as Record<string, unknown>
    expect(payload.changedFields).toEqual(['notifications'])
    // A quiet window is not a rule a past decision was judged under — it changes what happens NEXT.
    // So the log says it changed, and stops there.
    expect(JSON.stringify(payload)).not.toContain('500')
  })

  it('a studio that turns e-mail off still has in_app — she may not silence her own record', () => {
    // Enforced where it matters (`studioNotificationSettings` forces it back on), and asserted here
    // as the contract: she may say "not by e-mail"; she may not say "never tell me my class was
    // cancelled".
    const emailOff = { ...NOTIF, enabledChannels: ['in_app'] }
    const r = decideUpdateStudioSettings(ctx, settings(), settings({ notifications: emailOff }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.value[0]?.payload as { changedFields: string[] }).changedFields).toEqual(['notifications'])
  })
})
