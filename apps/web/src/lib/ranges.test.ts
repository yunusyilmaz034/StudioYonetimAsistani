import { describe, expect, it } from 'vitest'

import { resolveRange } from './ranges'

// Istanbul is UTC+3: the studio's 1 November starts at 31 October 21:00 UTC.
const at = (iso: string) => Date.parse(iso)

describe('calendar-month ranges, in the studio\'s time zone', () => {
  it('"Bu ay" runs from the 1st 00:00 Istanbul to now', () => {
    const now = at('2026-11-26T08:00:00Z')
    expect(resolveRange('thisMonth', now)).toEqual({ fromMs: at('2026-10-31T21:00:00Z'), toMs: now })
  })

  it('"Geçen ay" is the whole previous month, last millisecond included', () => {
    const r = resolveRange('lastMonth', at('2026-11-26T08:00:00Z'))
    expect(r).toEqual({ fromMs: at('2026-09-30T21:00:00Z'), toMs: at('2026-10-31T21:00:00Z') - 1 })
  })

  it('at 01:00 on the 1st Istanbul (still the previous day in UTC) it is already the new month', () => {
    const now = at('2026-11-30T22:00:00Z') // 1 Dec 01:00 Istanbul
    expect(resolveRange('thisMonth', now).fromMs).toBe(at('2026-11-30T21:00:00Z'))
  })

  it('January looks back to December of the previous year', () => {
    expect(resolveRange('lastMonth', at('2027-01-10T09:00:00Z')).fromMs).toBe(at('2026-11-30T21:00:00Z'))
  })
})
