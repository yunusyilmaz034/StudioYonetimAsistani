import { describe, expect, it } from 'vitest'

import { instant, money, type StudioId } from '../../../shared'
import {
  campaignDays,
  decideApproveCampaign,
  decideEditCampaign,
  decideProposeCampaign,
  decidePublished,
  decidePublishFailed,
  decideRemoveCampaign,
  decideStartPublishing,
  maxSpend,
} from './decide'
import type { AdCampaign, AdCampaignFields } from './types'

// The owner's caps (2026-11-04): 300 TL a day, 6.000 TL a campaign.
const CAPS = { dailyCap: money(30_000), campaignCap: money(600_000) }
const TODAY = '2026-11-04'
const ctx = (role = 'owner', today = TODAY) => ({
  studioId: 'std_1' as StudioId,
  actor: { type: role, id: 'usr_1' } as never,
  role,
  now: instant(1_793_750_000_000),
  today,
  correlationId: 'cor_1',
  source: 'reception_web',
})

const fields = (over: Partial<AdCampaignFields> = {}): AdCampaignFields => ({
  name: '12 Aylık Fitness · Kasım',
  dailyBudget: money(30_000),
  startDate: '2026-11-05',
  endDate: '2026-11-18', // 14 days → 4.200 TL
  targeting: { latitude: 40.8287, longitude: 29.4167, radiusKm: 7, ageMin: 25, ageMax: 50, label: 'Akse Mah. Çayırova' },
  creative: { igMediaId: '18012345678901234', primaryText: 'Bir yılın planı tek pakette.' },
  ...over,
})

const draft = (f = fields()): AdCampaign => {
  const r = decideProposeCampaign(ctx('receptionist'), { id: 'adc_1', origin: 'ai', rationale: 'neden', fields: f }, CAPS)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value.next
}
const approved = () => {
  const r = decideApproveCampaign(ctx(), draft(), CAPS)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value.next
}

describe('money arithmetic', () => {
  it('5–18 Kasım is 14 days; the most it can spend is 300 × 14 = 4.200 TL', () => {
    expect(campaignDays('2026-11-05', '2026-11-18')).toBe(14)
    expect(maxSpend(fields())).toEqual(money(420_000))
  })
  it('a one-day campaign is one day', () => expect(campaignDays('2026-11-05', '2026-11-05')).toBe(1))
})

describe('the caps — refused, never clamped', () => {
  it('EXACTLY 300 TL a day is allowed', () => expect(draft(fields({ dailyBudget: money(30_000) })).status).toBe('draft'))
  it('300,01 TL a day is refused', () => {
    expect(decideProposeCampaign(ctx(), { id: 'x', origin: 'ai', rationale: '', fields: fields({ dailyBudget: money(30_001) }) }, CAPS)).toEqual({
      ok: false,
      error: { code: 'ad_over_cap', which: 'daily', cap: 30_000 },
    })
  })
  it('EXACTLY 6.000 TL in total is allowed (300 × 20 days)', () =>
    expect(draft(fields({ startDate: '2026-11-05', endDate: '2026-11-24' })).status).toBe('draft'))
  it('6.000 TL + one day is refused — and nothing is saved', () => {
    const r = decideProposeCampaign(ctx(), { id: 'x', origin: 'ai', rationale: '', fields: fields({ startDate: '2026-11-05', endDate: '2026-11-25' }) }, CAPS)
    expect(r).toEqual({ ok: false, error: { code: 'ad_over_cap', which: 'campaign', cap: 600_000 } })
  })
  it('the AI is held to the same caps as a person', () => {
    const r = decideProposeCampaign(ctx('system'), { id: 'x', origin: 'ai', rationale: '', fields: fields({ dailyBudget: money(50_000) }) }, CAPS)
    expect(r.ok).toBe(false)
  })
})

describe('other refusals', () => {
  it.each([
    ['no end in sight: 91 days', fields({ dailyBudget: money(1_000), startDate: '2026-11-05', endDate: '2027-02-03' }), 'duration'],
    ['starts yesterday', fields({ startDate: '2026-11-03' }), 'dates'],
    ['ends before it starts', fields({ startDate: '2026-11-10', endDate: '2026-11-09' }), 'dates'],
    ['a malformed date', fields({ endDate: '18.11.2026' }), 'dates'],
    ['under 1 TL a day', fields({ dailyBudget: money(99) }), 'dailyBudget'],
    ['an empty name', fields({ name: '  ' }), 'name'],
    ['a radius of 0 km', fields({ targeting: { ...fields().targeting, radiusKm: 0 } }), 'targeting'],
    ['under-18 audience', fields({ targeting: { ...fields().targeting, ageMin: 17 } }), 'targeting'],
    ['age range upside down', fields({ targeting: { ...fields().targeting, ageMin: 40, ageMax: 30 } }), 'targeting'],
    ['no Instagram post', fields({ creative: { igMediaId: '', primaryText: 'x' } }), 'creative'],
    ['no ad text', fields({ creative: { igMediaId: '18012345678901234', primaryText: ' ' } }), 'creative'],
  ])('refuses %s', (_why, f, field) => {
    expect(decideProposeCampaign(ctx(), { id: 'x', origin: 'staff', rationale: '', fields: f }, CAPS)).toEqual({ ok: false, error: { code: 'ad_invalid', field } })
  })
  it('a campaign starting TODAY is allowed', () => expect(draft(fields({ startDate: TODAY, endDate: TODAY })).status).toBe('draft'))
})

describe('approval — the owner, and only the owner', () => {
  it('the owner approves; the caps it was judged under are stamped on the event', () => {
    const r = decideApproveCampaign(ctx(), draft(), CAPS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('approved')
    expect(r.value.events[0]?.payload).toMatchObject({ maxSpend: money(420_000), caps: CAPS, days: 14 })
  })
  it.each(['receptionist', 'trainer', 'system', 'member'])('REFUSES a %s', (role) =>
    expect(decideApproveCampaign(ctx(role), draft(), CAPS)).toEqual({ ok: false, error: { code: 'ad_approve_forbidden' } }))
  it('re-judges against TODAY: a draft whose start has passed cannot be approved as it stands', () =>
    expect(decideApproveCampaign(ctx('owner', '2026-11-06'), draft(), CAPS)).toEqual({ ok: false, error: { code: 'ad_invalid', field: 'dates' } }))
  it('re-judges against the CURRENT caps: lowered since the draft → refused', () =>
    expect(decideApproveCampaign(ctx(), draft(), { dailyCap: money(20_000), campaignCap: money(600_000) })).toEqual({
      ok: false,
      error: { code: 'ad_over_cap', which: 'daily', cap: 20_000 },
    }))
  it('cannot approve twice', () => expect(decideApproveCampaign(ctx(), approved(), CAPS)).toEqual({ ok: false, error: { code: 'ad_not_editable' } }))
})

describe('publishing — nothing reaches Meta without an approval, and only once', () => {
  it('a DRAFT cannot start publishing', () => expect(decideStartPublishing(ctx(), draft())).toEqual({ ok: false, error: { code: 'ad_not_approved' } }))
  it('an approved campaign starts publishing exactly once — the second press is refused', () => {
    const s = decideStartPublishing(ctx(), approved())
    expect(s.ok).toBe(true)
    if (!s.ok) return
    expect(s.value.next.status).toBe('publishing')
    expect(decideStartPublishing(ctx(), s.value.next)).toEqual({ ok: false, error: { code: 'ad_not_approved' } })
  })
  it('publishing → live with Meta ids', () => {
    const s = decideStartPublishing(ctx(), approved())
    if (!s.ok) throw new Error()
    const r = decidePublished(ctx(), s.value.next, { campaignId: '1', adSetId: '2', adId: '3' })
    expect(r.ok && r.value.next.status).toBe('live')
  })
  it('a failure SPENDS the approval: it must be approved again', () => {
    const s = decideStartPublishing(ctx(), approved())
    if (!s.ok) throw new Error()
    const f = decidePublishFailed(ctx(), s.value.next, { stage: 'ad', metaCode: '100', message: 'Görselde fazla yazı' })
    expect(f.ok).toBe(true)
    if (!f.ok) return
    expect(f.value.next).toMatchObject({ status: 'failed', approvedAt: null, approvedCaps: null })
    expect(JSON.stringify(f.value.events)).not.toContain('Görselde') // Meta's text stays on state
    expect(decideStartPublishing(ctx(), f.value.next)).toEqual({ ok: false, error: { code: 'ad_not_approved' } })
  })
})

describe('editing and removal', () => {
  it('a failed campaign that is edited becomes a draft again', () => {
    const s = decideStartPublishing(ctx(), approved())
    if (!s.ok) throw new Error()
    const f = decidePublishFailed(ctx(), s.value.next, { stage: 'ad', metaCode: null, message: '' })
    if (!f.ok) throw new Error()
    const e = decideEditCampaign(ctx('receptionist'), f.value.next, fields({ name: 'Yeni ad' }), CAPS)
    expect(e.ok && e.value.next.status).toBe('draft')
  })
  it.each(['approved', 'publishing', 'live', 'removed'] as const)('a %s campaign is not edited or removed here', (status) => {
    const c = { ...draft(), status }
    expect(decideEditCampaign(ctx(), c, fields({ name: 'x' }), CAPS)).toEqual({ ok: false, error: { code: 'ad_not_editable' } })
    expect(decideRemoveCampaign(ctx(), c)).toEqual({ ok: false, error: { code: 'ad_not_editable' } })
  })
  it('no ad text or rationale ever reaches an event', () => {
    const r = decideProposeCampaign(ctx(), { id: 'x', origin: 'ai', rationale: 'GİZLİ-GEREKÇE', fields: fields({ creative: { igMediaId: '18012345678901234', primaryText: 'GİZLİ-METİN' } }) }, CAPS)
    expect(JSON.stringify(r.ok && r.value.events)).not.toMatch(/GİZLİ/)
  })
})
