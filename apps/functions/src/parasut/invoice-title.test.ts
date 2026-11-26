import { describe, expect, it } from 'vitest'

import { invoiceTitle } from './api'

describe('invoiceTitle — what the owner reads in Paraşüt\'s list', () => {
  it('names the service and the day the money came in, Istanbul time', () => {
    expect(invoiceTitle('Fitness', Date.parse('2026-11-26T08:00:00Z'))).toBe('Fitness tahsilatı · 26.11.2026')
  })

  it('a payment at 23:30 Istanbul (20:30 UTC) is still that day; one at 00:30 is the next', () => {
    expect(invoiceTitle('Pilates', Date.parse('2026-11-30T20:30:00Z'))).toBe('Pilates tahsilatı · 30.11.2026')
    expect(invoiceTitle('Pilates', Date.parse('2026-11-30T21:30:00Z'))).toBe('Pilates tahsilatı · 01.12.2026')
  })

  it('never carries our internal payment id', () => {
    expect(invoiceTitle('Özel Ders', Date.parse('2026-11-26T08:00:00Z'))).not.toMatch(/pay_/)
  })
})
