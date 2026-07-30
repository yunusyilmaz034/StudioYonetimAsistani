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

  it('recognises what the BROWSER actually sees, not only the server log', () => {
    // The server logs "Failed to find Server Action …"; the client is handed a generic failure.
    // Matching only the server's wording meant an operator mid-import was told to "try again" —
    // the one thing that cannot work (2026-07-30).
    for (const real of [
      'An unexpected response was received from the server.',
      'Failed to fetch',
      'Load failed',
    ]) {
      expect(isStaleDeployment(new Error(real)), real).toBe(true)
    }
  })

  it('does NOT claim staleness for an ordinary failure — retrying is right there', () => {
    expect(isStaleDeployment(new Error('DEADLINE_EXCEEDED'))).toBe(false)
    expect(isStaleDeployment(null)).toBe(false)
    expect(saveErrorMessage(new Error('permission_denied'))).toBe(GENERIC_SAVE_ERROR)
  })
})
