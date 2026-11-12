import { describe, expect, it } from 'vitest'

import { isIgnoredContact } from './ignored-contacts'

describe('isIgnoredContact — the owners\' own chats never reach the desk', () => {
  it('matches a listed WhatsApp number and a listed Instagram key exactly', () => {
    const list = ['905000000001', 'ig_123']
    expect(isIgnoredContact(list, '905000000001')).toBe(true)
    expect(isIgnoredContact(list, 'ig_123')).toBe(true)
  })
  it('a customer is never dropped: no partial match, no list, a malformed list', () => {
    expect(isIgnoredContact(['905000000001'], '90500000000')).toBe(false)
    expect(isIgnoredContact(['ig_123'], 'ig_1234')).toBe(false)
    expect(isIgnoredContact(undefined, '905000000001')).toBe(false)
    expect(isIgnoredContact('905000000001', '905000000001')).toBe(false)
    expect(isIgnoredContact([42, null], '42')).toBe(false)
  })
})
