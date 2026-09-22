import { describe, expect, it } from 'vitest'

import { needsRepair, PANEL_SERVICE } from './min-instances-guard'

// The guard exists because App Hosting resets the floor on every rollout (OR-108). The only part
// with a judgement in it is WHEN to act — the rest is two HTTP calls.
describe('minInstances guard — when to put the floor back', () => {
  // THE CASE THE FIRST VERSION MISSED. Cloud Run omits `minInstanceCount` when it is zero, so the
  // service that has been scaled to sleep reads exactly like this. The guard's whole reason to exist
  // is this shape, and asking "is it exactly 0?" made it silent here. Measured on the live service.
  it('repairs a scaling block with NO floor in it — that is what zero looks like', () => {
    expect(needsRepair({ maxInstanceCount: 2 } as { minInstanceCount?: number }, 1)).toBe(true)
  })

  it('repairs an explicit zero', () => {
    expect(needsRepair({ minInstanceCount: 0 }, 1)).toBe(true)
  })

  it('leaves the wanted value alone', () => {
    expect(needsRepair({ minInstanceCount: 1 }, 1)).toBe(false)
  })

  // Somebody raised it on purpose — a load test, a busy weekend. An automation that stamps a human's
  // deliberate act back down is worse than no automation.
  it('never lowers a higher floor', () => {
    expect(needsRepair({ minInstanceCount: 3 }, 1)).toBe(false)
  })

  // No scaling block at all: the API has a shape we did not understand. Editing production on a
  // shape we cannot read is how an automation makes changes nobody can reconstruct later.
  it('does nothing when there is no scaling block to read', () => {
    expect(needsRepair(undefined, 1)).toBe(false)
  })

  it('targets the panel service the studio actually runs on', () => {
    expect(PANEL_SERVICE).toMatchObject({ location: 'europe-west4', service: 'studio-yonetim', wanted: 1 })
  })
})
