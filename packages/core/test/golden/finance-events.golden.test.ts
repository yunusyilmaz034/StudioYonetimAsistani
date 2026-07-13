import { describe, expect, it } from 'vitest'

import { decideCreateDrawer } from '../../src/modules/finance/domain/decide'
import {
  instant,
  type BranchId,
  type CorrelationId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import drawerCreated from './drawer.created.v1.json'

// `drawer.created` — the till (hotfix B-2, 2026-07-13).
//
// A studio started with no till and nothing could make one: `openDrawer` refused a drawer that did
// not exist, and no screen and no script created it. So on a fresh production project reception could
// take **no cash at all** — every cash sale was refused with `drawer_required`, correctly, and for
// ever. Creating a till is a state change, so it writes an event, like every other state change (#1).
//
// A NEW event type. Nothing existing is touched — no version bump, no upcaster.
//
// The payload carries the till's NAME, which is a thing ("Merkez Kasa"), not a person. #6 is about
// PII, and a drawer has none.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner' as const, id: 'usr_owner' as StaffUserId },
  now: instant(1_700_000_000_000),
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
}

describe('drawer.created', () => {
  it('matches the golden payload', () => {
    const r = decideCreateDrawer(ctx, null, {
      drawerId: 'drw_1',
      branchId: 'brn_1' as BranchId,
      name: 'Merkez Kasa',
      kind: 'cash',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('drawer.created')
    expect(r.value.events[0]?.payload).toEqual(drawerCreated)
  })

  it('is born CLOSED, holding nothing', () => {
    // A till that appears already open, with money in it, is a till whose opening balance nobody
    // counted — and the whole day-end count is judged against that number.
    const r = decideCreateDrawer(ctx, null, {
      drawerId: 'drw_1',
      branchId: 'brn_1' as BranchId,
      name: 'Merkez Kasa',
      kind: 'cash',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('closed')
    expect(r.value.next.expected.amount).toBe(0)
    expect(r.value.next.openedAt).toBeNull()
  })

  it('refuses a second till on the same id, and a nameless one', () => {
    const existing = { id: 'drw_1' } as never
    expect(
      decideCreateDrawer(ctx, existing, { drawerId: 'drw_1', branchId: 'brn_1' as BranchId, name: 'X', kind: 'cash' }).ok,
    ).toBe(false)
    expect(
      decideCreateDrawer(ctx, null, { drawerId: 'drw_2', branchId: 'brn_1' as BranchId, name: '  ', kind: 'cash' }).ok,
    ).toBe(false)
  })
})
