import { describe, expect, it } from 'vitest'
import { isStaleDeployment, saveErrorMessage, STALE_DEPLOYMENT_MESSAGE, GENERIC_SAVE_ERROR } from './stale-deployment'

describe('stale deployment', () => {
  it('recognises the Next.js message reception actually hit', () => {
    const real = new Error(
      'Failed to find Server Action "00f0acf437f742449de4edcdef2aef07c8494c88bb". This request might be from an older or newer deployment.',
    )
    expect(isStaleDeployment(real)).toBe(true)
    expect(saveErrorMessage(real)).toBe(STALE_DEPLOYMENT_MESSAGE)
  })

  it('recognises either fragment alone, so one wording change does not blind it', () => {
    expect(isStaleDeployment(new Error('… older or newer deployment.'))).toBe(true)
    expect(isStaleDeployment(new Error('Failed to find Server Action "abc".'))).toBe(true)
  })

  it('does NOT claim staleness for an ordinary failure — retrying is right there', () => {
    expect(isStaleDeployment(new Error('DEADLINE_EXCEEDED'))).toBe(false)
    expect(isStaleDeployment(null)).toBe(false)
    expect(saveErrorMessage(new Error('network'))).toBe(GENERIC_SAVE_ERROR)
  })
})
