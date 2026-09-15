import { describe, expect, it } from 'vitest'

import { decideStartAdPeriod, type DecideContext } from './decide'
import type { AdPeriod } from './types'
import { instant, type ActorRef, type CorrelationId, type StaffUserId, type StudioId } from '../../../shared'

const NOW = instant(1_700_000_000_000)
const DAY = 86_400_000
const ACTOR: ActorRef = { type: 'owner', id: 'usr_1' as StaffUserId }
const ctx: DecideContext = { studioId: 'std_1' as StudioId, actor: ACTOR, now: NOW, correlationId: 'cor_1' as CorrelationId, source: 'reception_web' }
const period = (over: Partial<AdPeriod> = {}): AdPeriod => ({
  id: 'adp_2',
  studioId: 'std_1' as StudioId,
  label: '15 Eylül reklamı',
  startedAt: instant(NOW - DAY),
  createdAt: NOW,
  createdBy: ACTOR,
  ...over,
})

describe('decideStartAdPeriod', () => {
  it('ilk dönem: olay önceki başlangıcı null taşır, ad kırpılır', () => {
    const r = decideStartAdPeriod(ctx, period({ label: '  15 Eylül reklamı ' }), null)
    expect(r.ok && r.value.next.label).toBe('15 Eylül reklamı')
    expect(r.ok && r.value.events[0]?.payload).toEqual({ label: '15 Eylül reklamı', startedAt: NOW - DAY, previousStartedAt: null })
    expect(r.ok && r.value.events[0]?.subject).toEqual({ kind: 'adPeriod', id: 'adp_2' })
  })
  it('yeni dönem öncekinden sonra başlarsa kabul, önceki başlangıç olayda', () => {
    const r = decideStartAdPeriod(ctx, period(), period({ id: 'adp_1', startedAt: instant(NOW - 30 * DAY) }))
    expect(r.ok && (r.value.events[0]?.payload as { previousStartedAt: number }).previousStartedAt).toBe(NOW - 30 * DAY)
  })
  it('REDDEDER: adsız ya da 60 karakterden uzun', () => {
    expect(decideStartAdPeriod(ctx, period({ label: '   ' }), null)).toEqual({ ok: false, error: { code: 'ad_period_label_required' } })
    expect(decideStartAdPeriod(ctx, period({ label: 'x'.repeat(61) }), null)).toEqual({ ok: false, error: { code: 'ad_period_label_required' } })
  })
  it('REDDEDER: gelecekte başlayan (sınır: tam 1 gün sonrası kabul, 1 ms fazlası ret)', () => {
    expect(decideStartAdPeriod(ctx, period({ startedAt: instant(NOW + DAY) }), null).ok).toBe(true)
    expect(decideStartAdPeriod(ctx, period({ startedAt: instant(NOW + DAY + 1) }), null)).toEqual({ ok: false, error: { code: 'ad_period_in_future' } })
  })
  it('REDDEDER: önceki dönemle aynı anda ya da önce başlayan', () => {
    const cur = period({ id: 'adp_1', startedAt: instant(NOW - DAY) })
    expect(decideStartAdPeriod(ctx, period({ startedAt: instant(NOW - DAY) }), cur)).toEqual({ ok: false, error: { code: 'ad_period_not_after_current' } })
    expect(decideStartAdPeriod(ctx, period({ startedAt: instant(NOW - 2 * DAY) }), cur)).toEqual({ ok: false, error: { code: 'ad_period_not_after_current' } })
  })
})
