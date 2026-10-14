import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type MemberId, type NewEvent, type TenantContext } from '../../../shared'
import type { CheckinDeps } from './ports'
import { sweepAutoCheckOut } from './sweep'

// OTOMATİK ÇIKIŞ, ZİYARETE GÖRE (owner, 2026-10-14). Çıkış kolu serbest kalınca ziyareti bitiren tek
// şey bu süpürge: ders günü gelen dersin bitişi + 30 dk'da, dersi olmayan girişten 2 saat sonra.

const NOW = Date.parse('2026-10-14T20:00:00+03:00')
const M = 60_000
const BRANCH = 'mutlukent' as BranchId
const CTX = { studioId: 'std', branchIds: [BRANCH], role: 'system', actor: { type: 'system', id: 'job' } } as unknown as TenantContext
const POLICY = { afterClassMs: 30 * M, withoutClassMs: 120 * M }

function run(inside: { id: string; inMinAgo: number; classEndsMinAgo: number | null }[]) {
  const closed: { memberId: string; events: readonly NewEvent[] }[] = []
  const deps = {
    clock: { now: () => instant(NOW) },
    repo: {
      listStalePresence: async () =>
        inside.map((p) => ({ memberId: p.id as MemberId, branchId: BRANCH, checkedInAt: instant(NOW - p.inMinAgo * M) })),
      applyAutoCheckOut: async (_c: TenantContext, memberId: MemberId, events: readonly NewEvent[]) => {
        closed.push({ memberId, events })
      },
    },
    classes: {
      hasClassAround: async () => false,
      classEndAround: async (_c: TenantContext, memberId: MemberId) => {
        const p = inside.find((x) => x.id === memberId)!
        return p.classEndsMinAgo === null ? null : instant(NOW - p.classEndsMinAgo * M)
      },
    },
  } as unknown as CheckinDeps
  return sweepAutoCheckOut(deps, CTX, POLICY).then((r) => ({ r, closed }))
}

describe('sweepAutoCheckOut — ders bitişine bağlı', () => {
  it('ders günü: ders bitti, 30 dk geçti → çıktı; payın içindeyse içeride kalır', async () => {
    const { closed } = await run([
      { id: 'mem_bitti', inMinAgo: 100, classEndsMinAgo: 31 },
      { id: 'mem_payda', inMinAgo: 100, classEndsMinAgo: 29 },
    ])
    expect(closed.map((c) => c.memberId)).toEqual(['mem_bitti'])
    // Girişten 99 dk sonra kapandı (ders bitişi + 30) — sabit 2 saat beklenmedi.
    expect(closed[0]?.events[0]?.payload).toEqual({ branchId: BRANCH, thresholdHours: 1.65 })
  })

  it('dersi yok: 2 saat dolunca çıktı, 1 dk eksikse içeride', async () => {
    const { closed } = await run([
      { id: 'mem_fit_doldu', inMinAgo: 120, classEndsMinAgo: null },
      { id: 'mem_fit_icerde', inMinAgo: 119, classEndsMinAgo: null },
    ])
    expect(closed.map((c) => c.memberId)).toEqual(['mem_fit_doldu'])
    expect(closed[0]?.events[0]?.type).toBe('member.auto_checked_out')
  })

  it('dersi hâlâ süren biri 2 saati aşsa da çıkarılmaz', async () => {
    const { closed } = await run([{ id: 'mem_uzun', inMinAgo: 150, classEndsMinAgo: -10 }])
    expect(closed).toHaveLength(0)
  })
})
