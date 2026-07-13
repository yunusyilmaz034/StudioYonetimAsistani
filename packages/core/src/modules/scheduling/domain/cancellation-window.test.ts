import { describe, expect, it } from 'vitest'

import type { StudioId } from '../../../shared'
import { resolveCancellationWindow } from './cancellation-window'
import type { SchedulingPolicy, StudioSettings } from './types'

// D14 — the chain: session override → service → studio → refuse.
// The system default (6 h) is NOT here and must never be: nothing in the code knows the
// number six (non-negotiable #4). It is data a studio is provisioned with.

const policy = (cancellationWindowHours: number | null): SchedulingPolicy => ({
  maxDaysInAdvance: 14,
  cancellationWindowHours,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: false,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
  allowMemberSelfBooking: false,
})

const studio = (defaultCancellationWindowHours: number | null): StudioSettings => ({
  studioId: 'std_1' as StudioId,
  defaultCancellationWindowHours,
  lowCreditThreshold: null,
  discountCeilingPercent: null,
})

describe('resolveCancellationWindow (D14)', () => {
  it('1 — the session override wins over everything', () => {
    expect(
      resolveCancellationWindow({
        sessionOverride: 2,
        servicePolicy: policy(6),
        studioSettings: studio(12),
      }),
    ).toEqual({ ok: true, value: { hours: 2, source: 'session' } })
  })

  it('2 — with no override, the SERVICE default answers', () => {
    expect(
      resolveCancellationWindow({
        sessionOverride: null,
        servicePolicy: policy(4),
        studioSettings: studio(12),
      }),
    ).toEqual({ ok: true, value: { hours: 4, source: 'service' } })
  })

  it('3 — a service that declines (null) falls through to the STUDIO default', () => {
    expect(
      resolveCancellationWindow({
        sessionOverride: null,
        servicePolicy: policy(null),
        studioSettings: studio(12),
      }),
    ).toEqual({ ok: true, value: { hours: 12, source: 'studio' } })
  })

  it('4 — nobody answers → REFUSE. The domain never invents a number', () => {
    expect(
      resolveCancellationWindow({
        sessionOverride: null,
        servicePolicy: policy(null),
        studioSettings: studio(null),
      }),
    ).toEqual({ ok: false, error: { code: 'cancellation_window_unresolved' } })
  })

  it('an unprovisioned studio (no settings document) also refuses, rather than defaulting', () => {
    expect(
      resolveCancellationWindow({
        sessionOverride: null,
        servicePolicy: policy(null),
        studioSettings: null,
      }),
    ).toEqual({ ok: false, error: { code: 'cancellation_window_unresolved' } })
  })

  it('an override of 0 is a real answer, not "unset"', () => {
    // Zero means "cancel any time, right up to the start". It must not fall through.
    expect(
      resolveCancellationWindow({
        sessionOverride: 0,
        servicePolicy: policy(6),
        studioSettings: studio(12),
      }),
    ).toEqual({ ok: true, value: { hours: 0, source: 'session' } })
  })

  it('a service window of 0 is likewise a real answer', () => {
    expect(
      resolveCancellationWindow({
        sessionOverride: null,
        servicePolicy: policy(0),
        studioSettings: studio(12),
      }),
    ).toEqual({ ok: true, value: { hours: 0, source: 'service' } })
  })
})
