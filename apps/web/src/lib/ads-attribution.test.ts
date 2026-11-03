import { describe, expect, it } from 'vitest'

import { ATTRIBUTION_WINDOW_MS, attribute, type AdsCampaign } from './ads-attribution'

const D = 86_400_000
const T0 = Date.UTC(2026, 10, 1, 9) // 2026-11-01 12:00 Istanbul
const campaigns: AdsCampaign[] = [
  { id: 'c1', name: '12 Aylık', status: 'ACTIVE', adIds: ['a1', 'a2'], days: { '2026-11-01': { spendKurus: 100_000, impressions: 1, clicks: 1, messages: 3 }, '2026-11-05': { spendKurus: 50_000, impressions: 1, clicks: 1, messages: 1 } } },
  { id: 'c2', name: 'Reformer', status: 'PAUSED', adIds: ['b1'], days: { '2026-11-02': { spendKurus: 80_000, impressions: 1, clicks: 1, messages: 1 } } },
]

const run = (over: Partial<Parameters<typeof attribute>[0]> = {}) =>
  attribute({
    from: T0 - D,
    to: T0 + 30 * D,
    campaigns,
    conversations: [],
    memberByPhone: new Map(),
    paymentsByMember: new Map(),
    ...over,
  })

describe('attribute', () => {
  it('sums spend inside the period and credits nobody without a conversation', () => {
    const r = run()
    expect(r.totals).toMatchObject({ spendKurus: 230_000, messages: 0, members: 0, costPerMemberKurus: null, revenuePerLira: 0 })
  })

  it('ad → phone → new member → payments inside 90 days', () => {
    const r = run({
      conversations: [
        { adId: 'a1', at: T0, phone: '905321111111' },
        { adId: 'a2', at: T0 + D, phone: null }, // Instagram, no phone yet: a message, not a lead
        { adId: 'b1', at: T0 + D, phone: '905322222222' }, // lead, never joined
      ],
      memberByPhone: new Map([['905321111111', { id: 'm1', joinedAt: T0 + 2 * D }]]),
      paymentsByMember: new Map([
        ['m1', [
          { receivedAt: T0 + 2 * D, amountKurus: 2_200_000, voided: false },
          { receivedAt: T0 + 3 * D, amountKurus: 500_000, voided: true }, // voided: not revenue
          { receivedAt: T0 + ATTRIBUTION_WINDOW_MS + D, amountKurus: 2_200_000, voided: false }, // renewal after 90 days: not this ad's
        ]],
      ]),
    })
    const c1 = r.campaigns.find((c) => c.id === 'c1')!
    expect(c1).toMatchObject({ spendKurus: 150_000, messages: 2, leads: 1, members: 1, revenueKurus: 2_200_000, costPerMemberKurus: 150_000 })
    expect(c1.revenuePerLira).toBe(14.7)
    expect(r.campaigns.find((c) => c.id === 'c2')).toMatchObject({ messages: 1, leads: 1, members: 0, costPerMemberKurus: null })
  })

  it('a member who was ALREADY ours and clicked an ad is not a sale the ad made', () => {
    const r = run({
      conversations: [{ adId: 'a1', at: T0, phone: '905321111111' }],
      memberByPhone: new Map([['905321111111', { id: 'm1', joinedAt: T0 - 40 * D }]]),
      paymentsByMember: new Map([['m1', [{ receivedAt: T0 + D, amountKurus: 900_000, voided: false }]]]),
    })
    expect(r.totals).toMatchObject({ leads: 1, members: 0, revenueKurus: 0 })
  })

  it('registered the morning of the same day she wrote that evening — still counts', () => {
    const r = run({
      conversations: [{ adId: 'a1', at: T0 + 10 * 3_600_000, phone: '905321111111' }],
      memberByPhone: new Map([['905321111111', { id: 'm1', joinedAt: T0 }]]),
    })
    expect(r.totals.members).toBe(1)
  })

  it('she wrote on WhatsApp and Instagram from the same ad: one member, not two', () => {
    const r = run({
      conversations: [
        { adId: 'a1', at: T0, phone: '905321111111' },
        { adId: 'a2', at: T0 + D, phone: '905321111111' },
      ],
      memberByPhone: new Map([['905321111111', { id: 'm1', joinedAt: T0 + 2 * D }]]),
      paymentsByMember: new Map([['m1', [{ receivedAt: T0 + 2 * D, amountKurus: 100_000, voided: false }]]]),
    })
    expect(r.totals).toMatchObject({ messages: 2, leads: 2, members: 1, revenueKurus: 100_000 })
  })

  it('a conversation from an ad we have no insights for goes to "Bilinmeyen reklam", not lost', () => {
    const r = run({ conversations: [{ adId: 'zz', at: T0, phone: null }] })
    expect(r.campaigns.find((c) => c.id === '_unknown')).toMatchObject({ name: 'Bilinmeyen reklam', messages: 1, spendKurus: 0 })
  })

  it('conversations and spend outside the period are left out', () => {
    const r = run({ from: T0 + 3 * D, to: T0 + 10 * D, conversations: [{ adId: 'a1', at: T0, phone: null }] })
    expect(r.totals).toMatchObject({ spendKurus: 50_000, messages: 0 })
  })
})
