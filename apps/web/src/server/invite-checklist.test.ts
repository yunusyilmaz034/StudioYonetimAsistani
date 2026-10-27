import { describe, expect, it } from 'vitest'

import { INVITE_LOOKBACK_DAYS, undeliveredInvites } from './invite-checklist'

// Davet WhatsApp'tan gitmediyse pano söyler; üye hesabını açınca susar (owner, 2026-10-27).
const NOW = Date.parse('2026-10-27T09:00:00+03:00')
const DAY = 86_400_000

describe('undeliveredInvites', () => {
  it('a failed invite for a member without an account is listed', () => {
    expect(undeliveredInvites([{ memberId: 'm1', failedAt: NOW - DAY }], [{ memberId: 'm1', status: 'pending' }], new Set(), NOW)).toHaveLength(1)
  })

  it('once she set her password (an invite consumed), the row is gone', () => {
    const r = undeliveredInvites(
      [{ memberId: 'm1', failedAt: NOW - DAY }],
      [{ memberId: 'm1', status: 'pending' }, { memberId: 'm1', status: 'consumed' }],
      new Set(),
      NOW,
    )
    expect(r).toEqual([])
  })

  it('a new link sent by hand does not clear it — only her signing in does', () => {
    const r = undeliveredInvites([{ memberId: 'm1', failedAt: NOW - DAY }], [{ memberId: 'm1', status: 'pending' }, { memberId: 'm1', status: 'pending' }], new Set(), NOW)
    expect(r).toHaveLength(1)
  })

  it('older than the window is not today’s work; the boundary day still is', () => {
    expect(undeliveredInvites([{ memberId: 'm1', failedAt: NOW - (INVITE_LOOKBACK_DAYS + 1) * DAY }], [], new Set(), NOW)).toEqual([])
    expect(undeliveredInvites([{ memberId: 'm1', failedAt: NOW - INVITE_LOOKBACK_DAYS * DAY }], [], new Set(), NOW)).toHaveLength(1)
  })

  it('two failures for one member are one row, newest first across members', () => {
    const r = undeliveredInvites(
      [
        { memberId: 'm1', failedAt: NOW - 3 * DAY },
        { memberId: 'm1', failedAt: NOW - DAY },
        { memberId: 'm2', failedAt: NOW - 2 * DAY },
      ],
      [],
      new Set(),
      NOW,
    )
    expect(r.map((x) => [x.memberId, x.failedAt])).toEqual([['m1', NOW - DAY], ['m2', NOW - 2 * DAY]])
  })

  it('excluded (test) accounts and empty member ids never appear', () => {
    expect(undeliveredInvites([{ memberId: 'test', failedAt: NOW }, { memberId: '', failedAt: NOW }], [], new Set(['test']), NOW)).toEqual([])
  })
})
