import { describe, expect, it } from 'vitest'

import { newCommandId, newEventId, newMemberId, newReservationId } from './ids'

describe('ids', () => {
  it('mints prefixed ULIDs (prefix + 26-char Crockford body)', () => {
    expect(newMemberId()).toMatch(/^mem_[0-9A-Z]{26}$/)
    expect(newEventId()).toMatch(/^evt_[0-9A-Z]{26}$/)
    expect(newCommandId()).toMatch(/^cmd_[0-9A-Z]{26}$/)
    expect(newReservationId()).toMatch(/^res_[0-9A-Z]{26}$/)
  })

  it('mints distinct ids on each call', () => {
    expect(newMemberId()).not.toBe(newMemberId())
  })
})
