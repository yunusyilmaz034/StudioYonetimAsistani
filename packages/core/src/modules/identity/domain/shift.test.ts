import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type CorrelationId, type Instant, type StaffUserId, type StudioId } from '../../../shared'
import { decideEndShift, decideStartShift } from './decide'
import type { StaffShift } from './types'

// MESAİ — günde iki karar (owner, 2026-09-01).
//
// Owner: *"pdks gibi değil de en azından saat kaçta girdi çıktı görsek yeterli."* Bu testin işi o
// cümlenin sınırlarını korumak: bir vardiya, bir kişi, ve kimse başkasının saatini yazamaz.

const BEN = 'usr_1' as StaffUserId
const BASKASI = 'usr_2' as StaffUserId
const SABAH = instant(1_700_000_000_000)
const SEKIZ_SAAT = instant((SABAH as number) + 8 * 3_600_000)

const ctx = (kim: StaffUserId, now: Instant = SABAH, type: 'receptionist' | 'trainer' | 'platform_admin' = 'receptionist') => ({
  studioId: 'std_1' as StudioId,
  actor: { type, id: kim as never },
  now,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web' as const,
})

const acikVardiya = (over: Partial<StaffShift> = {}): StaffShift => ({
  id: 'shf_1',
  staffUserId: BEN,
  branchId: 'brn_1' as BranchId,
  startedAt: SABAH,
  endedAt: null,
  ...over,
})

describe('mesai başlangıcı', () => {
  it('açık vardiyası olmayan kendi mesaisini başlatır', () => {
    const r = decideStartShift(ctx(BEN), { staffUserId: BEN, shiftId: 'shf_1', branchId: 'brn_1' as BranchId }, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0]?.type).toBe('staff.shift_started')
    expect(r.value[0]?.subject).toEqual({ kind: 'staff', id: BEN })
    // Şube yazılıyor: iki şubeli bir stüdyoda "kim neredeydi" ancak böyle sorulabilir.
    expect(r.value[0]?.branchId).toBe('brn_1')
  })

  it('AÇIK vardiya varken ikincisini REDDEDER', () => {
    const r = decideStartShift(ctx(BEN), { staffUserId: BEN, shiftId: 'shf_2', branchId: null }, acikVardiya())
    expect(r).toEqual({ ok: false, error: { code: 'shift_already_open' } })
  })

  it('bir BAŞKASININ adına mesai açmayı REDDEDER', () => {
    const r = decideStartShift(ctx(BASKASI), { staffUserId: BEN, shiftId: 'shf_1', branchId: null }, null)
    expect(r).toEqual({ ok: false, error: { code: 'own_shift_only' } })
  })
})

describe('mesai bitişi', () => {
  it('açık vardiyayı kapatır ve süresini dakika olarak yazar', () => {
    const r = decideEndShift(ctx(BEN, SEKIZ_SAAT), acikVardiya())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0]?.payload).toEqual({ staffUserId: BEN, shiftId: 'shf_1', minutes: 480 })
  })

  it('59 saniye bir dakika değildir — aşağı yuvarlanır', () => {
    const r = decideEndShift(ctx(BEN, instant((SABAH as number) + 59_000)), acikVardiya())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0]?.payload.minutes).toBe(0)
  })

  it('açık vardiya yokken REDDEDER — olmamış bir çıkış yazılmaz', () => {
    expect(decideEndShift(ctx(BEN), null)).toEqual({ ok: false, error: { code: 'no_open_shift' } })
  })

  it("bir başkasının vardiyasını kapatmayı REDDEDER", () => {
    expect(decideEndShift(ctx(BASKASI), acikVardiya())).toEqual({ ok: false, error: { code: 'own_shift_only' } })
  })
})

describe('olay yükü PII taşımaz (#6)', () => {
  it('yalnızca opak kimlik ve süre', () => {
    const b = decideStartShift(ctx(BEN), { staffUserId: BEN, shiftId: 'shf_1', branchId: null }, null)
    const s = decideEndShift(ctx(BEN, SEKIZ_SAAT), acikVardiya())
    expect(b.ok && Object.keys(b.value[0]!.payload).sort()).toEqual(['shiftId', 'staffUserId'])
    expect(s.ok && Object.keys(s.value[0]!.payload).sort()).toEqual(['minutes', 'shiftId', 'staffUserId'])
  })
})
