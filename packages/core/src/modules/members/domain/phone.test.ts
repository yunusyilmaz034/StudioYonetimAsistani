import { describe, expect, it } from 'vitest'

import { normalizePhone } from './phone'

describe('normalizePhone (E3, AD-40)', () => {
  it('normalises every accepted TR mobile shape to one E.164', () => {
    for (const raw of ['05321234567', '5321234567', '+90 532 123 45 67', '905321234567']) {
      const r = normalizePhone(raw)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.e164).toBe('+905321234567')
        expect(r.value.normalized).toBe('905321234567')
      }
    }
  })

  it('rejects landlines, too-short, and malformed numbers — never guesses', () => {
    for (const raw of ['02125551212', '53212345', '5321234567890', 'abc', '']) {
      const r = normalizePhone(raw)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('invalid_phone')
    }
  })
})
