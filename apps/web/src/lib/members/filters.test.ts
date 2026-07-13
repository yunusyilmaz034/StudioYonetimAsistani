import { describe, expect, it } from 'vitest'

import { badgesFor, type MemberFacts } from './filters'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

const facts = (over: Partial<MemberFacts> = {}): MemberFacts => ({
  status: 'active',
  balanceDueKurus: 0,
  packages: [],
  ...over,
})

describe('üye listesi filtreleri', () => {
  it('a frozen package is NOT expiring — that is what freezing it was for', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'frozen', validUntil: NOW + 3 * DAY, creditsAvailable: 4 }] }),
      NOW,
    )
    expect(b.frozen).toBe(true)
    // Putting a frozen member on the "chase her, her package is ending" list would undo the freeze
    // the studio just granted her.
    expect(b.expiring).toBe(false)
    expect(b.active).toBe(false)
  })

  it('an unlimited (period) package never counts as “kredisi azalan”', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW + 60 * DAY, creditsAvailable: null }] }),
      NOW,
    )
    expect(b.active).toBe(true)
    // It has no number to run out of. Reading `null` as zero would put every unlimited member on
    // the call list — which is how a useful filter becomes one nobody opens.
    expect(b.lowCredits).toBe(false)
  })

  it('sees two classes left, and not three', () => {
    const two = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW + 30 * DAY, creditsAvailable: 2 }] }),
      NOW,
    )
    const three = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW + 30 * DAY, creditsAvailable: 3 }] }),
      NOW,
    )
    expect(two.lowCredits).toBe(true)
    expect(three.lowCredits).toBe(false)
  })

  it('an expired package is not a membership — she is “paketsiz”, not “aktif”', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'expired', validUntil: NOW - DAY, creditsAvailable: 0 }] }),
      NOW,
    )
    expect(b.noPackage).toBe(true)
    expect(b.active).toBe(false)
  })

  it('a package that already ended is not “bitecek”', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW - DAY, creditsAvailable: 4 }] }),
      NOW,
    )
    expect(b.expiring).toBe(false)
  })

  it('selling without collecting is legal — and it must never be invisible', () => {
    expect(badgesFor(facts({ balanceDueKurus: 30_000 }), NOW).inDebt).toBe(true)
    expect(badgesFor(facts({ balanceDueKurus: 0 }), NOW).inDebt).toBe(false)
  })
})
