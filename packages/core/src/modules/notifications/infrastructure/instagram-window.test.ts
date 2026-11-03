import { describe, expect, it } from 'vitest'

import { INSTAGRAM_REPLY_WINDOW_MS, instagramWindowOpen } from './providers'

describe('instagramWindowOpen — the 24-hour reply window', () => {
  const now = 1_800_000_000_000
  it('is open just after her message', () => expect(instagramWindowOpen(now - 60_000, now)).toBe(true))
  it('is open one minute before 24 h', () => expect(instagramWindowOpen(now - INSTAGRAM_REPLY_WINDOW_MS + 60_000, now)).toBe(true))
  it('is CLOSED at exactly 24 h', () => expect(instagramWindowOpen(now - INSTAGRAM_REPLY_WINDOW_MS, now)).toBe(false))
  it('is closed when she never wrote', () => {
    expect(instagramWindowOpen(undefined, now)).toBe(false)
    expect(instagramWindowOpen(null, now)).toBe(false)
    expect(instagramWindowOpen(0, now)).toBe(false)
  })
})
