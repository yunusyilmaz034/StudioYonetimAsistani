import { describe, expect, it } from 'vitest'

import { instant, money, type StudioId } from '../../../shared'
import { decideChange, decideChangeApplied, decideChangeFailed, decideDismissChange, decideRequestChange, pendingAsChange } from './changes'
import type { AdCampaign } from './types'

// IG-5b — changing a campaign that is on Meta. Caps: 300 TL/day, 6.000 TL/campaign (owner).
const CAPS = { dailyCap: money(30_000), campaignCap: money(600_000) }
const ctx = (role = 'owner', today = '2026-11-10') => ({
  studioId: 'std_1' as StudioId,
  actor: { type: role === 'system' ? 'system' : 'staff', id: role } as never,
  role,
  now: instant(1_794_300_000_000),
  today,
  correlationId: 'cor_1',
  source: 'reception_web',
})

const live = (over: Partial<AdCampaign> = {}): AdCampaign => ({
  id: 'adc_1',
  studioId: 'std_1' as StudioId,
  name: '12 Aylık Fitness',
  status: 'live',
  origin: 'ai',
  dailyBudget: money(25_000),
  startDate: '2026-11-05',
  endDate: '2026-11-14', // 10 days → 2.500 TL
  targeting: { latitude: 40.8, longitude: 29.4, radiusKm: 8, ageMin: 25, ageMax: 50, label: 'x' },
  creative: { igMediaId: '17986375368025237', primaryText: 'x' },
  rationale: '',
  createdAt: instant(1),
  createdBy: { type: 'staff', id: 'o' } as never,
  approvedAt: instant(2),
  approvedBy: { type: 'staff', id: 'o' } as never,
  approvedCaps: CAPS,
  meta: { campaignId: '1', adSetId: '2', adId: '3' },
  failure: null,
  ...over,
})

describe('budget — the strict cap: new daily × ALL days', () => {
  it('300 TL × 10 days = 3.000 TL is allowed', () => expect(decideChange(ctx(), live(), { id: 'c', kind: 'budget', dailyBudget: money(30_000) }, CAPS).ok).toBe(true))
  it('300,01 TL a day is refused', () =>
    expect(decideChange(ctx(), live(), { id: 'c', kind: 'budget', dailyBudget: money(30_001) }, CAPS)).toEqual({ ok: false, error: { code: 'ad_over_cap', which: 'daily', cap: 30_000 } }))
  it('a 20-day campaign: 300 TL is exactly 6.000 TL — allowed', () =>
    expect(decideChange(ctx(), live({ endDate: '2026-11-24' }), { id: 'c', kind: 'budget', dailyBudget: money(30_000) }, CAPS).ok).toBe(true))
  it('a 21-day campaign: 300 TL is 6.300 TL — refused, even though days already spent cost less', () =>
    expect(decideChange(ctx(), live({ endDate: '2026-11-25' }), { id: 'c', kind: 'budget', dailyBudget: money(30_000) }, CAPS)).toEqual({
      ok: false,
      error: { code: 'ad_over_cap', which: 'campaign', cap: 600_000 },
    }))
  it('the same budget again is not a change', () =>
    expect(decideChange(ctx(), live(), { id: 'c', kind: 'budget', dailyBudget: money(25_000) }, CAPS)).toEqual({ ok: false, error: { code: 'operation_not_applicable' } }))
})

describe('end date', () => {
  it('extending to 24 Kasım at 250 TL/day (5.000 TL) is allowed', () =>
    expect(decideChange(ctx(), live(), { id: 'c', kind: 'end_date', endDate: '2026-11-24' }, CAPS).ok).toBe(true))
  it('extending past 6.000 TL is refused', () =>
    expect(decideChange(ctx(), live(), { id: 'c', kind: 'end_date', endDate: '2026-11-29' }, CAPS)).toEqual({ ok: false, error: { code: 'ad_over_cap', which: 'campaign', cap: 600_000 } }))
  it('past 90 days is refused', () =>
    expect(decideChange(ctx(), live({ dailyBudget: money(100) }), { id: 'c', kind: 'end_date', endDate: '2027-02-03' }, CAPS)).toEqual({ ok: false, error: { code: 'ad_invalid', field: 'duration' } }))
  it('an end in the past is refused (to stop now: pause)', () =>
    expect(decideChange(ctx(), live(), { id: 'c', kind: 'end_date', endDate: '2026-11-09' }, CAPS)).toEqual({ ok: false, error: { code: 'ad_invalid', field: 'dates' } }))
  it('ending TODAY is allowed', () => expect(decideChange(ctx(), live(), { id: 'c', kind: 'end_date', endDate: '2026-11-10' }, CAPS).ok).toBe(true))
})

describe('pause / resume', () => {
  it('a live campaign pauses; a paused one does not pause again', () => {
    expect(decideChange(ctx(), live(), { id: 'c', kind: 'pause' }, CAPS)).toMatchObject({ ok: true, value: { status: 'paused' } })
    expect(decideChange(ctx(), live({ status: 'paused' }), { id: 'c', kind: 'pause' }, CAPS)).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })
  it('resume: only a paused one, and not after its end date', () => {
    expect(decideChange(ctx(), live({ status: 'paused' }), { id: 'c', kind: 'resume' }, CAPS)).toMatchObject({ ok: true, value: { status: 'live' } })
    expect(decideChange(ctx('owner', '2026-11-15'), live({ status: 'paused' }), { id: 'c', kind: 'resume' }, CAPS)).toEqual({ ok: false, error: { code: 'ad_invalid', field: 'dates' } })
  })
  it.each(['draft', 'approved', 'publishing', 'failed', 'removed'] as const)('a %s campaign is not changed here', (status) =>
    expect(decideChange(ctx(), live({ status }), { id: 'c', kind: 'pause' }, CAPS)).toEqual({ ok: false, error: { code: 'ad_not_editable' } }))
})

describe('who', () => {
  it.each(['receptionist', 'trainer', 'system'])('a %s cannot change a campaign on Meta', (role) =>
    expect(decideChange(ctx(role), live(), { id: 'c', kind: 'pause' }, CAPS)).toEqual({ ok: false, error: { code: 'ad_approve_forbidden' } }))
})

describe('the AI asks; the owner decides', () => {
  const req = decideRequestChange(ctx('system'), live(), { id: 'chg_1', kind: 'budget', dailyBudget: money(30_000) }, 'neden', CAPS)
  it('the request is stored, nothing else moves', () => {
    expect(req.ok).toBe(true)
    if (!req.ok) return
    expect(req.value.next).toMatchObject({ status: 'live', dailyBudget: money(25_000), pendingChange: { id: 'chg_1', kind: 'budget', dailyBudget: money(30_000) } })
    expect(req.value.events[0]?.payload).toMatchObject({ maxSpend: money(300_000) })
  })
  it('a request over the cap never exists', () =>
    expect(decideRequestChange(ctx('system'), live(), { id: 'x', kind: 'budget', dailyBudget: money(40_000) }, '', CAPS).ok).toBe(false))
  it('one pending request per campaign', () => {
    if (!req.ok) throw new Error()
    expect(decideRequestChange(ctx('system'), req.value.next, { id: 'x', kind: 'pause' }, '', CAPS)).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })
  it('approved + Meta accepted → applied, request cleared, caps stamped', () => {
    if (!req.ok) throw new Error()
    const ch = pendingAsChange(req.value.next)!
    const a = decideChangeApplied(ctx(), req.value.next, ch, 'ai', CAPS)
    expect(a.ok).toBe(true)
    if (!a.ok) return
    expect(a.value.next).toMatchObject({ dailyBudget: money(30_000), pendingChange: null })
    expect(a.value.events[0]?.payload).toMatchObject({ origin: 'ai', from: { dailyBudget: money(25_000) }, to: { dailyBudget: money(30_000) }, maxSpend: money(300_000), caps: CAPS })
  })
  it('caps lowered since the request → approval refused', () => {
    if (!req.ok) throw new Error()
    expect(decideChangeApplied(ctx(), req.value.next, pendingAsChange(req.value.next)!, 'ai', { dailyCap: money(20_000), campaignCap: money(600_000) }).ok).toBe(false)
  })
  it('Meta refused → the campaign keeps its budget; the request is spent', () => {
    if (!req.ok) throw new Error()
    const f = decideChangeFailed(ctx(), req.value.next, pendingAsChange(req.value.next)!, 'ai', { metaCode: '100', message: 'GİZLİ' })
    expect(f.ok && f.value.next).toMatchObject({ dailyBudget: money(25_000), pendingChange: null, lastChangeFailure: { kind: 'budget', metaCode: '100' } })
    expect(JSON.stringify(f.ok && f.value.events)).not.toContain('GİZLİ')
  })
  it('the owner dismisses; nobody else can', () => {
    if (!req.ok) throw new Error()
    expect(decideDismissChange(ctx(), req.value.next)).toMatchObject({ ok: true, value: { next: { pendingChange: null } } })
    expect(decideDismissChange(ctx('receptionist'), req.value.next)).toEqual({ ok: false, error: { code: 'ad_approve_forbidden' } })
  })
  it('a pause records who and when; resume clears it', () => {
    const p = decideChangeApplied(ctx(), live(), { id: 'c', kind: 'pause' }, 'staff', CAPS)
    if (!p.ok) throw new Error()
    expect(p.value.next).toMatchObject({ status: 'paused', pausedBy: { id: 'owner' } })
    const r = decideChangeApplied(ctx(), p.value.next, { id: 'd', kind: 'resume' }, 'staff', CAPS)
    expect(r.ok && r.value.next).toMatchObject({ status: 'live', pausedAt: null })
  })
})
