import { describe, expect, it } from 'vitest'

import { decideCorrectDiscount, decideCreateDrawer, decideWithdrawCash } from '../../src/modules/finance/domain/decide'
import {
  instant,
  type BranchId,
  type CorrelationId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import type { Sale } from '../../src/modules/finance/domain/types'
import { money } from '../../src/shared'
import drawerCreated from './drawer.created.v1.json'
import withdrawn from './cash.withdrawn.v1.json'
import discountCorrected from './sale.discount_corrected.v1.json'

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

// `sale.discount_corrected` — taking back a discount entered wrongly (owner, 2026-08-11).
//
// A NEW event type. Nothing existing is touched — no version bump, no upcaster. It mirrors
// `sale.discounted` so the pair can be read together: what was given, what was taken back.
//
// The note is NOT in the payload. It is free text a human typed about a member's sale, and #6 keeps
// that out of the log; `hasNote` records the auditable fact that one exists.
describe('sale.discount_corrected', () => {
  const sale = {
    id: 'sal_1',
    branchId: 'brn_1',
    memberId: 'mbr_1',
    lines: [],
    discounts: [
      { reason: 'gift', amount: money(100_000), note: '', couponCode: null, referredByMemberId: null, grantedBy: ctx.actor },
    ],
    gross: money(500_000),
    total: money(400_000),
    paid: money(400_000),
    status: 'settled',
  } as unknown as Sale

  it('matches the golden payload', () => {
    const r = decideCorrectDiscount(ctx, sale, {
      reason: 'wrong_amount',
      amount: money(20_000),
      note: 'Resepsiyon 1.000 girdi, anlaşma 800 idi.',
      correctedBy: ctx.actor,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.type).toBe('sale.discount_corrected')
    expect(r.value.events[0]?.payload).toEqual(discountCorrected)
  })

  it('carries no PII — the note stays on the sale, only its existence is logged', () => {
    const r = decideCorrectDiscount(ctx, sale, {
      reason: 'other',
      amount: money(10_000),
      note: 'Ayşe Yılmaz yanlışlıkla iki kez indirim aldı',
      correctedBy: ctx.actor,
    })
    if (!r.ok) throw new Error('unreachable')
    expect(JSON.stringify(r.value.events[0]?.payload)).not.toContain('Ayşe')
  })
})

// ── cash.withdrawn v1 (owner onayı, 2026-09-04) ─────────────────────────────────────────────
//
// Finansın gider tarafı yoktu; bu, olay kaydındaki ilk çıkış. Şekli sabitleniyor çünkü bir olay
// yazıldıktan sonra düzenlenmez: burada eklenen ya da adı değişen bir alan, defterde kalıcı bir
// çataldır.
//
// PII yok ve olmaması yapısal: kime ödendiği bir AD ise `reason`da kalır, ve oraya isim yazmak
// resepsiyonun tercihidir — sistem ayrı bir "kime" alanı açsaydı isim olay kaydına ZORUNLU girerdi.
describe('cash.withdrawn v1', () => {
  const drawer = {
    id: 'drw_01K000000000000000000000',
    studioId: 'std_1',
    branchId: 'brn_1',
    name: 'Merkez Kasa',
    kind: 'cash',
    status: 'open',
    openingFloat: money(0),
    expected: money(100_000_000),
    active: true,
  } as never

  it('payload sabit sözleşmeye uyuyor', () => {
    const r = decideWithdrawCash(ctx, drawer, {
      outflowId: 'cof_01K000000000000000000000',
      category: 'bank_deposit',
      amount: money(70_000_000),
      reason: 'Bankaya yatırıldı — Ziraat',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events[0]?.payload).toEqual(withdrawn)
  })

  it('payload üyeye ait hiçbir alan taşımıyor', () => {
    const r = decideWithdrawCash(ctx, drawer, {
      outflowId: 'cof_1',
      category: 'trainer_pay',
      amount: money(500_000),
      reason: 'x',
    })
    if (!r.ok) return
    expect(Object.keys(r.value.events[0]!.payload as object).sort()).toEqual(
      ['amount', 'category', 'drawerId', 'outflowId', 'reason'].sort(),
    )
  })
})
