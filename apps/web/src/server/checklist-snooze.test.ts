import { describe, expect, it } from 'vitest'

import { CHECKLIST_COOLDOWN_DAYS, isSnoozedNow } from './checklist-snooze'

// A ticked "bir arayın" line must survive the day it was ticked (so reception can see what she
// closed, and undo a mis-tick) and be gone the next morning — that pair IS the rule.
const TRT = (iso: string) => new Date(iso).getTime() // ISO carries its own offset

describe('checklist cooldown', () => {
  const at = TRT('2026-09-03T13:00:00+03:00')
  const until = at + 7 * 86_400_000
  const entry = { at, until }

  it('tiklendiği gün listede kalır — üstü çizili, geri alınabilir', () => {
    expect(isSnoozedNow(entry, TRT('2026-09-03T13:00:01+03:00'))).toBe(false)
    expect(isSnoozedNow(entry, TRT('2026-09-03T23:59:59+03:00'))).toBe(false)
  })

  it('ertesi sabah listeden çıkar', () => {
    expect(isSnoozedNow(entry, TRT('2026-09-04T00:00:01+03:00'))).toBe(true)
    expect(isSnoozedNow(entry, TRT('2026-09-09T12:00:00+03:00'))).toBe(true)
  })

  it('süre dolunca geri gelir — sebep hâlâ duruyorsa iş hâlâ iştir', () => {
    expect(isSnoozedNow(entry, until + 1)).toBe(false)
  })

  it('gece yarısı sınırı stüdyonun saatiyle okunur, tarayıcının değil', () => {
    // 2026-09-03 22:30 UTC is already the 4th in Istanbul — a tick at 23:00 TRT on the 3rd is
    // "yesterday" by 00:30 TRT, not by 00:30 UTC.
    const gece = { at: TRT('2026-09-03T23:00:00+03:00'), until: TRT('2026-09-10T23:00:00+03:00') }
    expect(isSnoozedNow(gece, TRT('2026-09-03T23:30:00+03:00'))).toBe(false)
    expect(isSnoozedNow(gece, TRT('2026-09-04T00:30:00+03:00'))).toBe(true)
  })

  it('yalnızca insanın telefon ettiği işler soğur', () => {
    expect(CHECKLIST_COOLDOWN_DAYS.dormant_member).toBe(7)
    expect(CHECKLIST_COOLDOWN_DAYS.empty_session).toBeUndefined()
  })
})
