import { describe, expect, it } from 'vitest'

import { parseAdvice } from './ads-advisor'

describe('parseAdvice — what the model says becomes at most ONE request', () => {
  it('pause', () => expect(parseAdvice({ action: 'pause', dailyBudgetTl: 0, endDate: '', rationale: '1.900 TL, 3 mesaj.' })).toEqual({ action: 'pause', rationale: '1.900 TL, 3 mesaj.' }))
  it('budget', () => expect(parseAdvice({ action: 'budget', dailyBudgetTl: 300, endDate: '', rationale: 'iyi' })).toEqual({ action: 'budget', dailyBudgetTl: 300, rationale: 'iyi' }))
  it('end date', () => expect(parseAdvice({ action: 'end_date', dailyBudgetTl: 0, endDate: '2026-11-24', rationale: 'uzat' })).toMatchObject({ action: 'end_date', endDate: '2026-11-24' }))
  it.each([
    ['no reason', { action: 'pause', rationale: ' ' }],
    ['budget without an amount', { action: 'budget', dailyBudgetTl: 0, rationale: 'x' }],
    ['a fractional budget', { action: 'budget', dailyBudgetTl: 250.5, rationale: 'x' }],
    ['a malformed date', { action: 'end_date', endDate: '24.11.2026', rationale: 'x' }],
    ['an unknown action', { action: 'delete', rationale: 'x' }],
    ['garbage', null],
  ])('%s → none', (_w, raw) => expect(parseAdvice(raw)).toEqual({ action: 'none' }))
})
