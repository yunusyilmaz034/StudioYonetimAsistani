import { describe, expect, it } from 'vitest'

import { instant, type CorrelationId, type Instant, type StaffUserId, type StudioId } from '../../../shared'
import {
  decideCloseBreakWithShift,
  decideCorrectBreak,
  decideEndBreak,
  decideEnterBreakRetroactively,
  decideStartBreak,
} from './break'
import type { DecideContext } from './decide'
import type { StaffBreak, StaffShift } from './types'

const BEN = 'usr_1' as StaffUserId
const BASKASI = 'usr_2' as StaffUserId
const T0 = 1_700_000_000_000

const ctx = (
  now: number,
  actor: { type: 'trainer' | 'receptionist' | 'owner' | 'system' | 'platform_admin'; id?: StaffUserId } = { type: 'trainer' },
): DecideContext =>
  ({
    studioId: 'std_1' as StudioId,
    actor: { type: actor.type, id: (actor.id ?? BEN) as never },
    now: instant(now),
    correlationId: 'cor_1' as CorrelationId,
    source: 'reception_web',
  }) as DecideContext

const vardiya = (over: Partial<StaffShift> = {}): StaffShift => ({
  id: 'shf_1',
  staffUserId: BEN,
  branchId: null,
  startedAt: instant(T0),
  endedAt: null,
  lastCrossingAt: null,
  ...over,
})

const mola = (over: Partial<StaffBreak> = {}): StaffBreak => ({
  id: 'brk_1',
  staffUserId: BEN,
  shiftId: 'shf_1',
  startedAt: instant(T0 + 3_600_000),
  endedAt: null,
  source: 'live',
  ...over,
})

describe('molaya başla', () => {
  it('açık vardiya varken başlar', () => {
    const r = decideStartBreak(ctx(T0 + 3_600_000), { staffUserId: BEN, shiftId: 'shf_1', breakId: 'brk_1' }, vardiya(), null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0]?.type).toBe('staff.break_started')
  })

  // owner kararı (2026-10-07): molanın bağlanacağı vardiya yoksa kayıt yetim kalır.
  it('VARDİYASIZ mola REDDEDİLİR', () => {
    const r = decideStartBreak(ctx(T0), { staffUserId: BEN, shiftId: 'shf_1', breakId: 'brk_1' }, null, null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('no_open_shift')
  })

  it('kapanmış vardiyada mola REDDEDİLİR', () => {
    const r = decideStartBreak(
      ctx(T0),
      { staffUserId: BEN, shiftId: 'shf_1', breakId: 'brk_1' },
      vardiya({ endedAt: instant(T0 + 1000) }),
      null,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('no_open_shift')
  })

  it('AYNI ANDA İKİNCİ mola REDDEDİLİR', () => {
    const r = decideStartBreak(ctx(T0), { staffUserId: BEN, shiftId: 'shf_1', breakId: 'brk_2' }, vardiya(), mola())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('break_already_open')
  })

  it('başkasının adına mola REDDEDİLİR', () => {
    const r = decideStartBreak(ctx(T0), { staffUserId: BASKASI, shiftId: 'shf_1', breakId: 'brk_1' }, vardiya(), null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('own_shift_only')
  })
})

describe('molayı bitir', () => {
  it('dakika AŞAĞI yuvarlanır — 59 saniye bir mola değildir', () => {
    const r = decideEndBreak(ctx(T0 + 3_600_000 + 30 * 60_000 + 59_000), mola())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload.minutes).toBe(30)
  })

  it('açık mola yoksa REDDEDİLİR', () => {
    expect(decideEndBreak(ctx(T0), null).ok).toBe(false)
    expect(decideEndBreak(ctx(T0), mola({ endedAt: instant(T0 + 1000) })).ok).toBe(false)
  })

  // #11: sonradan girilmiş bir molanın bitişi `live` görünmemeli.
  it("olay molanın KENDİ source'unu taşır", () => {
    const r = decideEndBreak(ctx(T0 + 4_000_000), mola({ source: 'retro_entry' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload.source).toBe('retro_entry')
  })
})

describe('geriye dönük giriş — BEYAN, gözlem değil', () => {
  const PENCERE = { opensAt: instant(T0), closesAt: instant(T0 + 6 * 86_400_000) }
  const girdi = {
    staffUserId: BEN,
    shiftId: 'shf_1',
    breakId: 'brk_9',
    startedAt: instant(T0 + 3_600_000),
    endedAt: instant(T0 + 5_400_000),
  }

  it('pencere içinde kabul edilir ve retro_entry işaretlenir', () => {
    const r = decideEnterBreakRetroactively(ctx(T0 + 86_400_000), girdi, vardiya(), [], PENCERE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.source).toBe('retro_entry')
    expect(r.value.events).toHaveLength(2)
    // occurredAt BEYAN EDİLEN saatlerdir, beyanın yapıldığı an değil (D2).
    expect(r.value.events[0]?.occurredAt).toBe(girdi.startedAt)
    expect(r.value.events[1]?.occurredAt).toBe(girdi.endedAt)
  })

  it('pencere KAPANDIKTAN sonra reddedilir', () => {
    const r = decideEnterBreakRetroactively(ctx(T0 + 7 * 86_400_000), girdi, vardiya(), [], PENCERE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('retro_entry_window_closed')
  })

  it('başka bir haftanın saatine girilemez', () => {
    const eski = { ...girdi, startedAt: instant(T0 - 86_400_000), endedAt: instant(T0 - 80_000_000) }
    const r = decideEnterBreakRetroactively(ctx(T0 + 86_400_000), eski, vardiya(), [], PENCERE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('retro_entry_window_closed')
  })

  it('mevcut molayla ÇAKIŞAN giriş reddedilir', () => {
    const r = decideEnterBreakRetroactively(
      ctx(T0 + 86_400_000),
      girdi,
      vardiya(),
      [mola({ startedAt: instant(T0 + 4_000_000), endedAt: instant(T0 + 4_600_000) })],
      PENCERE,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('break_overlaps')
  })

  it('vardiyanın BAŞLANGICINDAN önceye girilemez', () => {
    const r = decideEnterBreakRetroactively(
      ctx(T0 + 86_400_000),
      { ...girdi, startedAt: instant(T0 + 60_000) },
      vardiya({ startedAt: instant(T0 + 120_000) }),
      [],
      PENCERE,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_time_range')
  })

  it('bitiş başlangıçtan sonra olmalı', () => {
    const r = decideEnterBreakRetroactively(
      ctx(T0 + 86_400_000),
      { ...girdi, endedAt: girdi.startedAt },
      vardiya(),
      [],
      PENCERE,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_time_range')
  })

  it('başkasının molasını giremez', () => {
    const r = decideEnterBreakRetroactively(
      ctx(T0 + 86_400_000),
      { ...girdi, staffUserId: BASKASI },
      vardiya(),
      [],
      PENCERE,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('own_shift_only')
  })
})

describe('23:00 kapanışında açık mola', () => {
  it('kapatılır ve auto_closed İŞARETLENİR (#11)', () => {
    const kapanis = instant(T0 + 10 * 3_600_000) as Instant
    const r = decideCloseBreakWithShift(ctx(T0 + 20 * 3_600_000, { type: 'system' }), mola(), kapanis)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.source).toBe('auto_closed')
    expect(r.value.next.endedAt).toBe(kapanis)
    expect(r.value.events[0]?.occurredAt).toBe(kapanis)
  })

  it('kapanış molanın başlangıcından önceyse başlangıca sabitlenir — negatif mola olmaz', () => {
    const r = decideCloseBreakWithShift(ctx(T0, { type: 'system' }), mola(), instant(T0))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.endedAt).toBe(mola().startedAt)
  })

  it('zaten kapalı molaya dokunmaz', () => {
    const r = decideCloseBreakWithShift(ctx(T0, { type: 'system' }), mola({ endedAt: instant(T0 + 1000) }), instant(T0))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('no_open_break')
  })
})

describe('yönetici düzeltmesi (§13)', () => {
  const kapali = mola({ endedAt: instant(T0 + 5_400_000) })

  it('SEBEPSİZ düzeltme REDDEDİLİR', () => {
    const r = decideCorrectBreak(ctx(T0, { type: 'owner' }), kapali, { endedAt: instant(T0 + 6_000_000) }, '   ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('reason_required')
  })

  it('sebeple yapılır ve ÖNCESİ/SONRASI kayda geçer', () => {
    const r = decideCorrectBreak(ctx(T0, { type: 'owner' }), kapali, { endedAt: instant(T0 + 6_000_000) }, 'Turnike okutamadı')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = r.value.events[0]!.payload
    expect(p.changedFields).toEqual(['endedAt'])
    expect(p.changes.endedAt).toEqual({ from: T0 + 5_400_000, to: T0 + 6_000_000 })
    expect(p.reason).toBe('Turnike okutamadı')
  })

  it('PERSONEL kendi geçmiş molasını düzeltemez', () => {
    const r = decideCorrectBreak(ctx(T0, { type: 'trainer' }), kapali, { endedAt: instant(T0 + 6_000_000) }, 'sebep')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('break_correction_forbidden')
  })

  it('resepsiyon düzeltebilir (owner kararı)', () => {
    const r = decideCorrectBreak(ctx(T0, { type: 'receptionist' }), kapali, { endedAt: instant(T0 + 6_000_000) }, 'sebep')
    expect(r.ok).toBe(true)
  })

  it('DEĞİŞEN bir şey yoksa olay yazılmaz — aynı değer bir düzeltme değildir', () => {
    const r = decideCorrectBreak(ctx(T0, { type: 'owner' }), kapali, { endedAt: kapali.endedAt }, 'sebep')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events).toHaveLength(0)
  })

  it('bitişi başlangıcın önüne çeken düzeltme reddedilir', () => {
    const r = decideCorrectBreak(ctx(T0, { type: 'owner' }), kapali, { endedAt: instant(T0) }, 'sebep')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_time_range')
  })
})
