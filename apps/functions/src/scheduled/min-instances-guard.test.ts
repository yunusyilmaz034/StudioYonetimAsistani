import { describe, expect, it } from 'vitest'

import { needsRepair, PANEL_SERVICE } from './min-instances-guard'

// The guard exists because App Hosting resets the floor on every rollout (OR-108). The only part
// with a judgement in it is WHEN to act — the rest is two HTTP calls.
describe('minInstances guard — when to put the floor back', () => {
  it('repairs an explicit zero', () => {
    expect(needsRepair(0, 1)).toBe(true)
  })

  it('leaves the wanted value alone', () => {
    expect(needsRepair(1, 1)).toBe(false)
  })

  // Somebody raised it on purpose — a load test, a busy weekend. An automation that stamps a human's
  // deliberate act back down is worse than no automation.
  it('never lowers a higher floor', () => {
    expect(needsRepair(3, 1)).toBe(false)
  })

  // The read failed, or the API's shape changed. Acting on a shape we did not understand is how an
  // automation starts editing production for reasons nobody can reconstruct later.
  it('does nothing when the value is missing', () => {
    expect(needsRepair(undefined, 1)).toBe(false)
  })

  it('targets the panel service the studio actually runs on', () => {
    expect(PANEL_SERVICE).toMatchObject({ location: 'europe-west4', service: 'studio-yonetim', wanted: 1 })
  })
})
