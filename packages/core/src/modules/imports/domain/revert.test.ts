import { describe, expect, it } from 'vitest'

import type { Instant, MemberId } from '../../../shared'
import { decideRevert, type EntitlementActivity, type MemberActivity } from './revert'
import type { ImportBatch } from './types'

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  id: 'imp_1',
  kind: 'members',
  fileName: 'uyeler.xlsx',
  rowCount: 74,
  createdMemberIds: ['mem_a' as MemberId],
  createdEntitlementIds: [],
  skipped: 0,
  status: 'applied',
  appliedAt: 1_785_000_000_000 as Instant,
  revertedAt: null,
  ...over,
})

const quiet = (name: string): MemberActivity => ({
  memberId: 'mem_a' as MemberId,
  fullName: name,
  reservations: 0,
  checkIns: 0,
  payments: 0,
  otherEntitlements: 0,
})

const unusedPackage = (name: string): EntitlementActivity => ({
  entitlementId: 'ent_a',
  memberName: name,
  creditsUsed: 0,
  frozen: false,
})

describe('decideRevert', () => {
  it('allows an untouched batch — the case this exists for', () => {
    expect(decideRevert(batch(), [quiet('AYŞE YILMAZ')], [unusedPackage('AYŞE YILMAZ')])).toEqual({ ok: true })
  })

  it('allows a batch that created nothing at all', () => {
    expect(decideRevert(batch(), [], [])).toEqual({ ok: true })
  })

  it('refuses a batch already reverted — a second undo is not a no-op', () => {
    expect(decideRevert(batch({ status: 'reverted' }), [], [])).toEqual({ ok: false, code: 'already_reverted' })
  })

  it('refuses once an imported member has booked', () => {
    const v = decideRevert(batch(), [{ ...quiet('AYŞE YILMAZ'), reservations: 1 }], [])
    expect(v).toMatchObject({ ok: false, code: 'batch_touched' })
    if (v.ok || v.code !== 'batch_touched') throw new Error('unreachable')
    expect(v.blockers).toEqual([{ subject: 'AYŞE YILMAZ', because: '1 rezervasyon' }])
  })

  it('refuses on a check-in, a payment, or a package sold afterwards', () => {
    for (const field of ['checkIns', 'payments', 'otherEntitlements'] as const) {
      const v = decideRevert(batch(), [{ ...quiet('X'), [field]: 2 }], [])
      expect(v.ok, field).toBe(false)
    }
  })

  it('refuses once an imported package has paid for a class', () => {
    // A package with credits spent is no longer a bad import — it is a record with a real class
    // hanging off it. Cancelling it would strand that class against a member who never joined.
    const v = decideRevert(batch(), [], [{ ...unusedPackage('AYŞE'), creditsUsed: 1 }])
    expect(v).toMatchObject({ ok: false, code: 'batch_touched' })
  })

  it('refuses a frozen package — a freeze is a decision somebody made about it', () => {
    const v = decideRevert(batch(), [], [{ ...unusedPackage('AYŞE'), frozen: true }])
    expect(v).toMatchObject({ ok: false, code: 'batch_touched' })
  })

  it('reports EVERY blocker, not just the first', () => {
    // An operator who fixes one and is then told about the next has been made to discover the
    // problem in instalments.
    const v = decideRevert(
      batch(),
      [{ ...quiet('AYŞE'), reservations: 1 }, { ...quiet('ARZU'), checkIns: 3 }],
      [{ ...unusedPackage('ZEYNEP'), creditsUsed: 2, frozen: true }],
    )
    if (v.ok || v.code !== 'batch_touched') throw new Error('unreachable')
    expect(v.blockers).toHaveLength(3)
    expect(v.blockers[2]).toEqual({ subject: 'ZEYNEP', because: '2 ders kullanılmış · paket dondurulmuş' })
  })

  it('names several reasons for one subject in one line', () => {
    const v = decideRevert(batch(), [{ ...quiet('AYŞE'), reservations: 2, checkIns: 1, payments: 1 }], [])
    if (v.ok || v.code !== 'batch_touched') throw new Error('unreachable')
    expect(v.blockers[0]!.because).toBe('2 rezervasyon · 1 giriş · 1 ödeme')
  })
})
