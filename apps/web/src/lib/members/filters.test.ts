import { describe, expect, it } from 'vitest'

import { badgesFor, matches, type MemberBadges, type MemberFacts } from './filters'

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
    // ...but she IS active (owner, 2026-08-01): she has bought and she is coming back. Her membership
    // is paused, not finished, and "duraklatılmış" is for the member whose package actually ended.
    expect(b.state).toBe('active')
  })

  it('an unlimited (period) package never counts as “kredisi azalan”', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW + 60 * DAY, creditsAvailable: null }] }),
      NOW,
    )
    expect(b.state).toBe('active')
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

  it('an expired package is not a membership — she is “duraklatılmış”, not “aktif”', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'expired', validUntil: NOW - DAY, creditsAvailable: 0 }] }),
      NOW,
    )
    expect(b.state).toBe('paused')
  })

  // The nightly sweep flips `status` to `expired`; until it runs, a package that ran out at midnight
  // still reads `active`. "Aktif üye" must not mean "a cron fired last night" (owner, 2026-08-01).
  it('a package whose DATE has passed is not live, whatever its status still says', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW - DAY, creditsAvailable: 4 }] }),
      NOW,
    )
    expect(b.state).toBe('paused')
  })

  // Freezing stops the clock and does NOT extend validUntil until it is lifted. Judging a frozen
  // package by a date it is deliberately outrunning would drop her out of Aktif mid-freeze.
  it('a frozen package stays live even past its stored end date', () => {
    const b = badgesFor(
      facts({ packages: [{ status: 'frozen', validUntil: NOW - DAY, creditsAvailable: 4 }] }),
      NOW,
    )
    expect(b.state).toBe('active')
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

  it('a live bundle component makes her “hibrit”; a plain package does not', () => {
    const hybrid = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW + 30 * DAY, creditsAvailable: 8, isBundle: true }] }),
      NOW,
    )
    const plain = badgesFor(
      facts({ packages: [{ status: 'active', validUntil: NOW + 30 * DAY, creditsAvailable: 8 }] }),
      NOW,
    )
    expect(hybrid.hybrid).toBe(true)
    expect(plain.hybrid).toBe(false)
  })
})

// ── "Tümü" is every member the studio still has (owner, 2026-07-31) ─────────────────────────
describe('the three states', () => {
  const badges = (over: Partial<MemberBadges> = {}): MemberBadges => ({
    state: 'active', expiring: false, lowCredits: false, frozen: false,
    inDebt: false, hybrid: false, categories: [],
    ...over,
  })

  it('excludes a passive member from "Tümü"', () => {
    // Making a member passive exists to take her out of the day's work. Leaving her in the default
    // list undoes the only thing that button does.
    expect(matches('all', badges({ state: 'passive' }))).toBe(false)
    expect(matches('all', badges())).toBe(true)
  })

  it('still shows her under "Pasif" — hidden from the default, not from the studio', () => {
    expect(matches('passive', badges({ state: 'passive' }))).toBe(true)
  })

  // She is the win-back list. Hiding her from "Tümü" the way a passive member is hidden would hide
  // the very people the studio most needs to call.
  it('KEEPS a duraklatılmış member in "Tümü"', () => {
    expect(matches('all', badges({ state: 'paused' }))).toBe(true)
    expect(matches('paused', badges({ state: 'paused' }))).toBe(true)
    expect(matches('active', badges({ state: 'paused' }))).toBe(false)
  })

  // The declaration outranks the ledger: a member marked for removal is PASIF even if a package of
  // hers is still valid — which is exactly when the studio needs to see her under "Pasif".
  it('a passive member with a live package is still passive', () => {
    const b = badgesFor(
      facts({ status: 'inactive', packages: [{ status: 'active', validUntil: NOW + 30 * DAY, creditsAvailable: 8 }] }),
      NOW,
    )
    expect(b.state).toBe('passive')
  })

  it('the three states are exhaustive and mutually exclusive', () => {
    for (const state of ['active', 'paused', 'passive'] as const) {
      const hits = (['active', 'paused', 'passive'] as const).filter((f) => matches(f, badges({ state })))
      expect(hits).toEqual([state])
    }
  })
})
