import { describe, expect, it } from 'vitest'

import {
  decideApproveCampaign,
  decideEditCampaign,
  decideProposeCampaign,
  decidePublished,
  decidePublishFailed,
  decideRemoveCampaign,
  decideStartPublishing,
} from '../../src/modules/ads/domain/decide'
import type { AdCampaignFields } from '../../src/modules/ads/domain/types'
import { instant, money, type StudioId } from '../../src/shared'
import { decideChangeApplied, decideChangeFailed, decideDismissChange, decideRequestChange, pendingAsChange } from '../../src/modules/ads/domain/changes'
import approved from './ad_campaign.approved.v1.json'
import changeApplied from './ad_campaign.change_applied.v1.json'
import changeDismissed from './ad_campaign.change_dismissed.v1.json'
import changeFailed from './ad_campaign.change_failed.v1.json'
import changeRequested from './ad_campaign.change_requested.v1.json'
import edited from './ad_campaign.edited.v1.json'
import failed from './ad_campaign.publish_failed.v1.json'
import started from './ad_campaign.publish_started.v1.json'
import proposed from './ad_campaign.proposed.v1.json'
import published from './ad_campaign.published.v1.json'
import removed from './ad_campaign.removed.v1.json'

// IG-5a (2026-11-04) — NEW event types. Money facts, dates, the caps, Meta ids. Never the ad copy, the
// AI's rationale or Meta's error text — those stay on state.

const CAPS = { dailyCap: money(30_000), campaignCap: money(600_000) }
const ctx = { studioId: 'std_1' as StudioId, actor: { type: 'owner', id: 'usr_o' } as never, role: 'owner', now: instant(1_793_750_000_000), today: '2026-11-04', correlationId: 'cor_1', source: 'reception_web' }
const fields: AdCampaignFields = {
  name: 'GİZLİ-AD',
  dailyBudget: money(30_000),
  startDate: '2026-11-05',
  endDate: '2026-11-18',
  targeting: { latitude: 40.8, longitude: 29.4, radiusKm: 7, ageMin: 25, ageMax: 50, label: 'GİZLİ-YER' },
  creative: { igMediaId: '18012345678901234', primaryText: 'GİZLİ-METİN' },
}
const clean = (e: unknown) => expect(JSON.stringify(e)).not.toMatch(/GİZLİ/)

describe('ad campaign events', () => {
  const p = decideProposeCampaign(ctx, { id: 'adc_1', origin: 'ai', rationale: 'GİZLİ-GEREKÇE', fields }, CAPS)
  if (!p.ok) throw new Error('setup')

  it('ad_campaign.proposed', () => {
    expect(p.value.events[0]?.payload).toEqual(proposed)
    clean(p.value.events)
  })
  it('ad_campaign.edited', () => {
    const e = decideEditCampaign(ctx, p.value.next, { ...fields, dailyBudget: money(20_000) }, CAPS)
    if (!e.ok) throw new Error()
    expect(e.value.events[0]?.payload).toEqual(edited)
    clean(e.value.events)
  })
  it('ad_campaign.approved + publish_started + published / publish_failed', () => {
    const a = decideApproveCampaign(ctx, p.value.next, CAPS)
    if (!a.ok) throw new Error()
    expect(a.value.events[0]?.payload).toEqual(approved)
    const s = decideStartPublishing(ctx, a.value.next)
    if (!s.ok) throw new Error()
    expect(s.value.events[0]?.payload).toEqual(started)
    const ok = decidePublished(ctx, s.value.next, { campaignId: '120200000000000001', adSetId: '120200000000000002', adId: '120200000000000003' })
    expect(ok.ok && ok.value.events[0]?.payload).toEqual(published)
    const f = decidePublishFailed(ctx, s.value.next, { stage: 'creative', metaCode: '100', message: 'GİZLİ-META-HATASI' })
    if (!f.ok) throw new Error()
    expect(f.value.events[0]?.payload).toEqual(failed)
    clean([a.value.events, s.value.events, f.value.events])
  })
  it('ad_campaign.removed', () => {
    const r = decideRemoveCampaign(ctx, p.value.next)
    expect(r.ok && r.value.events[0]?.payload).toEqual(removed)
  })
})

describe('ad campaign change events (IG-5b)', () => {
  const live = {
    id: 'adc_1', studioId: 'std_1' as StudioId, name: 'GİZLİ-AD', status: 'live' as const, origin: 'ai' as const,
    dailyBudget: money(25_000), startDate: '2026-11-05', endDate: '2026-11-14', targeting: fields.targeting, creative: fields.creative,
    rationale: '', createdAt: instant(1), createdBy: ctx.actor, approvedAt: instant(2), approvedBy: ctx.actor, approvedCaps: CAPS,
    meta: { campaignId: '1', adSetId: '2', adId: '3' }, failure: null,
  }
  const sys = { ...ctx, role: 'system', today: '2026-11-10' }
  const own = { ...ctx, today: '2026-11-10' }
  const r = decideRequestChange(sys, live, { id: 'chg_1', kind: 'budget', dailyBudget: money(30_000) }, 'GİZLİ-GEREKÇE', CAPS)
  if (!r.ok) throw new Error('setup')
  const ch = pendingAsChange(r.value.next)!

  it('ad_campaign.change_requested', () => {
    expect(r.value.events[0]?.payload).toEqual(changeRequested)
    clean(r.value.events)
  })
  it('ad_campaign.change_applied', () => {
    const a = decideChangeApplied(own, r.value.next, ch, 'ai', CAPS)
    expect(a.ok && a.value.events[0]?.payload).toEqual(changeApplied)
    clean(a.ok && a.value.events)
  })
  it('ad_campaign.change_failed', () => {
    const f = decideChangeFailed(own, r.value.next, ch, 'ai', { metaCode: '100', message: 'GİZLİ-META' })
    expect(f.ok && f.value.events[0]?.payload).toEqual(changeFailed)
    clean(f.ok && f.value.events)
  })
  it('ad_campaign.change_dismissed', () => {
    const d = decideDismissChange(own, r.value.next)
    expect(d.ok && d.value.events[0]?.payload).toEqual(changeDismissed)
  })
})
