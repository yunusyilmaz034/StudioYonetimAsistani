import { describe, expect, it } from 'vitest'

import { decimalToKurus, driftOf, metaEndToLastDay, overspent, summarizeInsights } from './ads-insights'

describe('decimalToKurus — money never passes through a float', () => {
  it.each([
    ['12.34', 1234],
    ['7', 700],
    ['0.5', 50],
    ['0.005', 1], // half a kuruş rounds up
    ['0.004', 0],
    ['1234.999', 123500],
    ['', 0],
    ['abc', 0],
    [undefined, 0],
    ['-5', 0],
  ])('%s → %i', (raw, want) => expect(decimalToKurus(raw)).toBe(want))
})

describe('summarizeInsights', () => {
  const base = { accountId: 'act_1', currency: 'TRY', syncedAt: 1 }

  it('groups rows by campaign and day, summing ads, counting messaging conversations', () => {
    const s = summarizeInsights({
      ...base,
      campaigns: [{ id: 'c1', name: '12 Aylık Fitness', effective_status: 'ACTIVE' }],
      rows: [
        { campaign_id: 'c1', ad_id: 'a1', date_start: '2026-11-01', spend: '10.50', impressions: '100', clicks: '4', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }, { action_type: 'link_click', value: '4' }] },
        { campaign_id: 'c1', ad_id: 'a2', date_start: '2026-11-01', spend: '4.50', impressions: '50', clicks: '1' },
        { campaign_id: 'c1', ad_id: 'a1', date_start: '2026-11-02', spend: '3', impressions: '20', clicks: '0', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '1' }] },
      ],
    })
    expect(s.campaigns).toEqual([
      {
        id: 'c1',
        name: '12 Aylık Fitness',
        status: 'ACTIVE',
        adIds: ['a1', 'a2'],
        days: {
          '2026-11-01': { spendKurus: 1500, impressions: 150, clicks: 5, messages: 2 },
          '2026-11-02': { spendKurus: 300, impressions: 20, clicks: 0, messages: 1 },
        },
      },
    ])
  })

  it('keeps a campaign with no spend yet (just created) and names one Meta gave no name', () => {
    const s = summarizeInsights({ ...base, campaigns: [{ id: 'c2', effective_status: 'PAUSED' }], rows: [] })
    expect(s.campaigns).toEqual([{ id: 'c2', name: 'c2', status: 'PAUSED', adIds: [], days: {} }])
  })

  it('a row for a campaign missing from the list still counts (status unknown)', () => {
    const s = summarizeInsights({ ...base, campaigns: [], rows: [{ campaign_id: 'c3', campaign_name: 'Eski', date_start: '2026-10-01', spend: '1' }] })
    expect(s.campaigns[0]).toMatchObject({ id: 'c3', name: 'Eski', status: 'UNKNOWN' })
  })
})

describe('overspent — the nightly cap check (IG-5a)', () => {
  const summary = {
    campaigns: [
      { id: 'm1', name: 'A', status: 'ACTIVE', adIds: [], days: { '2026-11-05': { spendKurus: 300_000, impressions: 0, clicks: 0, messages: 0 }, '2026-11-06': { spendKurus: 130_000, impressions: 0, clicks: 0, messages: 0 } } },
      { id: 'm2', name: 'B', status: 'ACTIVE', adIds: [], days: { '2026-11-05': { spendKurus: 420_000, impressions: 0, clicks: 0, messages: 0 } } },
    ],
  }
  it('flags a campaign that spent more than approved', () =>
    expect(overspent(summary, [{ name: 'A', metaCampaignId: 'm1', maxSpendKurus: 420_000 }])).toEqual([{ name: 'A', spentKurus: 430_000, maxSpendKurus: 420_000 }]))
  it('EXACTLY the approved amount is not an overspend', () => expect(overspent(summary, [{ name: 'B', metaCampaignId: 'm2', maxSpendKurus: 420_000 }])).toEqual([]))
  it('a campaign Meta has no spend for yet is fine', () => expect(overspent(summary, [{ name: 'C', metaCampaignId: 'm9', maxSpendKurus: 1 }])).toEqual([]))
})

describe('driftOf — Meta changed by hand (IG-5b)', () => {
  const ours = { status: 'live' as const, dailyBudgetKurus: 25_000, endDate: '2026-11-14' }
  it('all as approved → null', () => expect(driftOf(ours, { campaignStatus: 'ACTIVE', dailyBudget: '25000', endTime: '2026-11-15T00:00:00+0300' })).toBeNull())
  it('budget raised in Ads Manager', () =>
    expect(driftOf(ours, { campaignStatus: 'ACTIVE', dailyBudget: '35000', endTime: '2026-11-15T00:00:00+0300' })).toEqual({ dailyBudgetKurus: 35_000, endDate: null, status: null }))
  it('end moved', () => expect(driftOf(ours, { campaignStatus: 'ACTIVE', dailyBudget: '25000', endTime: '2026-11-21T00:00:00+0300' })?.endDate).toBe('2026-11-20'))
  it('paused on Meta while we think it is live', () => expect(driftOf(ours, { campaignStatus: 'PAUSED', dailyBudget: '25000' })?.status).toBe('PAUSED'))
  it('paused on both sides is fine', () => expect(driftOf({ ...ours, status: 'paused' }, { campaignStatus: 'PAUSED', dailyBudget: '25000' })).toBeNull())
  it('Meta end time in UTC form reads the same day', () => expect(metaEndToLastDay('2026-11-14T21:00:00+0000')).toBe('2026-11-14'))
})
