import { describe, expect, it } from 'vitest'

import { decideStartAdPeriod, type DecideContext } from '../../src/modules/crm/domain/decide'
import { instant, type CorrelationId, type StaffUserId, type StudioId } from '../../src/shared'
import adPeriodStarted from './ad_period.started.v1.json'

const NOW = instant(1_700_000_000_000)
const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_1' as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}

// Reklam dönemi (2026-09-15). Payload bir ad ve iki an taşır — kişi yok, telefon yok (#6).
describe('ad_period.started', () => {
  it('payload', () => {
    const r = decideStartAdPeriod(
      ctx,
      { id: 'adp_1', studioId: 'std_1' as StudioId, label: '15 Eylül reklamı', startedAt: instant(1_699_913_600_000), createdAt: NOW, createdBy: ctx.actor },
      null,
    )
    expect(r.ok && r.value.events[0]?.payload).toEqual(adPeriodStarted)
    expect(r.ok && r.value.events[0]?.type).toBe('ad_period.started')
  })
})
