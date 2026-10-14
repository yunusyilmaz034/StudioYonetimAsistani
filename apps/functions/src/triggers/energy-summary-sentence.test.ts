import { describe, expect, it } from 'vitest'

import { energySummarySentence } from './on-event-notify'

// The evening summary (1.9.0): what she burned, and — unless she hid the figures — what she ate.
describe('energySummarySentence', () => {
  it('activity and meals', () => {
    expect(energySummarySentence({ totalKcal: '1.910', activeKcal: '570', intakeKcal: '1.420' })).toBe(
      'bugün yaklaşık 1.910 kcal yaktın (570 kadarı hareketten), 1.420 kcal aldın.',
    )
  })
  it('meals only — no "0 kadarı hareketten"', () => {
    expect(energySummarySentence({ totalKcal: '1.340', activeKcal: null, intakeKcal: '1.420' })).toBe('bugün yaklaşık 1.340 kcal yaktın, 1.420 kcal aldın.')
  })
  it('figures hidden: the intake is not in the sentence at all', () => {
    expect(energySummarySentence({ totalKcal: '1.910', activeKcal: '570', intakeKcal: null })).toBe('bugün yaklaşık 1.910 kcal yaktın (570 kadarı hareketten).')
  })
})
