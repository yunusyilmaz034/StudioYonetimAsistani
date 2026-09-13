import { describe, expect, it } from 'vitest'

import { instant, instantFromLocalDate, type BranchId, type CorrelationId, type Instant, type StaffUserId, type StudioId } from '../../../shared'
import { decideCloseShiftAtLastCrossing, decideEndShift, decideStaffCrossing, decideStartShift } from './decide'
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
  lastCrossingAt: null,
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

// ── TURNİKEDEN MESAİ (owner, 2026-09-13 · OR-74) ────────────────────────────────────────────
//
// *"İlk QR okutması mesai başlangıcı, son okutması mesai çıkışı sayılsın; gün içinde çoklu giriş
// yapabilirler."*
describe('turnikeden mesai', () => {
  const OFFSET = 180
  // 2027-01-15 09:00 İstanbul. Günün ortasında, gece yarısından uzakta. `Date` domain'de testte de yasak.
  const GECE_YARISI = instantFromLocalDate('2027-01-15', OFFSET)! as number
  const DOKUZ = instant(GECE_YARISI + 9 * 3_600_000)
  const saatSonra = (h: number) => instant((DOKUZ as number) + h * 3_600_000)
  const gecis = (kim: StaffUserId, now: Instant) =>
    decideStaffCrossing(ctx(kim, now, 'trainer'), { staffUserId: kim, deviceId: 'dev_1', branchId: 'brn_1' as BranchId, direction: 'in', newShiftId: 'shf_yeni', utcOffsetMinutes: OFFSET }, null)

  it('günün İLK geçişi vardiyayı açar: önce geçiş, sonra vardiya olayı', () => {
    const r = gecis(BEN, DOKUZ)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events.map((e) => e.type)).toEqual(['staff.crossed', 'staff.shift_started'])
    expect(r.value.shiftStarted).toBe(true)
    expect(r.value.shifts).toEqual([
      { id: 'shf_yeni', staffUserId: BEN, branchId: 'brn_1', startedAt: DOKUZ, endedAt: null, lastCrossingAt: DOKUZ },
    ])
  })

  it('aynı gün SONRAKİ geçiş yeni vardiya AÇMAZ — yalnızca son geçişi ilerletir', () => {
    const acik = acikVardiya({ startedAt: DOKUZ, lastCrossingAt: DOKUZ })
    const r = decideStaffCrossing(
      ctx(BEN, saatSonra(4), 'trainer'),
      { staffUserId: BEN, deviceId: 'dev_2', branchId: 'brn_1' as BranchId, direction: 'out', newShiftId: 'shf_yeni', utcOffsetMinutes: OFFSET },
      acik,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events.map((e) => e.type)).toEqual(['staff.crossed'])
    expect(r.value.shiftStarted).toBe(false)
    expect(r.value.shiftStartedAt).toBe(DOKUZ)
    expect(r.value.shifts).toEqual([{ ...acik, lastCrossingAt: saatSonra(4) }])
  })

  it('DÜNDEN kalan açık vardiyayı önce son geçişine kapatır, sonra bugününü açar', () => {
    // Dün 09:00 açılmış, son geçiş dün 18:00; gece işi çalışmamış. Bugün 09:00 turnike.
    const dun = acikVardiya({ id: 'shf_dun', startedAt: instant((DOKUZ as number) - 86_400_000), lastCrossingAt: instant((DOKUZ as number) - 15 * 3_600_000) })
    const r = decideStaffCrossing(
      ctx(BEN, DOKUZ, 'trainer'),
      { staffUserId: BEN, deviceId: 'dev_1', branchId: 'brn_1' as BranchId, direction: 'in', newShiftId: 'shf_yeni', utcOffsetMinutes: OFFSET },
      dun,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.events.map((e) => e.type)).toEqual(['staff.shift_ended', 'staff.crossed', 'staff.shift_started'])
    // Dünkü vardiya BUGÜN 09:00'a değil, dünkü son geçişe kapanıyor: 9 saat.
    expect(r.value.events[0]?.payload).toEqual({ staffUserId: BEN, shiftId: 'shf_dun', minutes: 540 })
    expect(r.value.events[0]?.occurredAt).toBe(dun.lastCrossingAt)
    expect(r.value.shifts[1]?.id).toBe('shf_yeni')
  })

  it('gün sınırı İSTANBUL günüdür: 23:59 ile 00:01 farklı günlerdir, UTC öyle demese de', () => {
    // 23:59 İstanbul = 20:59Z; 00:01 İstanbul = 21:01Z — UTC'de ikisi de aynı gün.
    const gece = instant(GECE_YARISI + 24 * 3_600_000 - 60_000)
    const sabah = instant(GECE_YARISI + 24 * 3_600_000 + 60_000)
    const acik = acikVardiya({ startedAt: gece, lastCrossingAt: gece })
    const r = decideStaffCrossing(
      ctx(BEN, sabah, 'trainer'),
      { staffUserId: BEN, deviceId: 'dev_1', branchId: 'brn_1' as BranchId, direction: 'in', newShiftId: 'shf_yeni', utcOffsetMinutes: OFFSET },
      acik,
    )
    expect(r.ok && r.value.shiftStarted).toBe(true)
  })

  it('bir BAŞKASI adına geçişi REDDEDER', () => {
    const r = decideStaffCrossing(
      ctx(BASKASI, DOKUZ, 'trainer'),
      { staffUserId: BEN, deviceId: 'dev_1', branchId: 'brn_1' as BranchId, direction: 'in', newShiftId: 'shf_yeni', utcOffsetMinutes: OFFSET },
      null,
    )
    expect(r).toEqual({ ok: false, error: { code: 'own_shift_only' } })
  })

  it('geçiş yükü PII taşımaz ve vardiyaya BAĞLANMAZ (yorum değişirse geçişler yeniden okunabilsin)', () => {
    const r = gecis(BEN, DOKUZ)
    expect(r.ok && Object.keys(r.value.events[0]!.payload).sort()).toEqual(['deviceId', 'direction', 'staffUserId'])
  })
})

describe('gece işi — son geçişe kapatma', () => {
  const sistem = (now: Instant) => ({
    studioId: 'std_1' as StudioId,
    actor: { type: 'system' as const, id: 'staff_shift_close' as never },
    now,
    correlationId: 'cor_1' as CorrelationId,
    source: 'system_sweep' as const,
  })
  const GECE = instant((SABAH as number) + 14 * 3_600_000)

  it('SON GEÇİŞ saatine kapatır — işin çalıştığı 23:00\'e değil', () => {
    const son = instant((SABAH as number) + 9 * 3_600_000)
    const r = decideCloseShiftAtLastCrossing(sistem(GECE), acikVardiya({ lastCrossingAt: son }))
    expect(r.ok).toBe(true)
    if (!r.ok || !r.value) return
    expect(r.value.shift.endedAt).toBe(son)
    expect(r.value.events[0]?.occurredAt).toBe(son)
    expect(r.value.events[0]?.payload).toEqual({ staffUserId: BEN, shiftId: 'shf_1', minutes: 540 })
    expect(r.value.events[0]?.actor.type).toBe('system')
  })

  it('geçişi OLMAYAN vardiyaya dokunmaz — gözlenmemiş bir bitiş uydurulmaz (#11)', () => {
    expect(decideCloseShiftAtLastCrossing(sistem(GECE), acikVardiya({ lastCrossingAt: null }))).toEqual({ ok: true, value: null })
  })

  it('kapanmış vardiyayı REDDEDER', () => {
    expect(decideCloseShiftAtLastCrossing(sistem(GECE), acikVardiya({ endedAt: SABAH, lastCrossingAt: SABAH }))).toEqual({
      ok: false,
      error: { code: 'no_open_shift' },
    })
  })

  it('başka bir personel kapatamaz', () => {
    expect(decideCloseShiftAtLastCrossing(ctx(BASKASI, GECE), acikVardiya({ lastCrossingAt: SABAH }))).toEqual({
      ok: false,
      error: { code: 'own_shift_only' },
    })
  })
})
