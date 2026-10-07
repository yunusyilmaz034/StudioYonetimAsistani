import { describe, expect, it } from 'vitest'

import { instant, instantFromLocalDate, type CorrelationId, type StaffUserId, type StudioId } from '../../../shared'
import type { DecideContext } from './decide'
import { buildTimesheetSnapshot, decideGenerateTimesheet, decideSignTimesheet, sameTimesheetContent } from './timesheet'
import type { StaffBreak, StaffShift, TimesheetDay, WeeklyTimesheet } from './types'

const BEN = 'usr_1' as StaffUserId
const T0 = 1_700_000_000_000

const ctx = (actorType: 'owner' | 'receptionist' | 'trainer' = 'owner', now = T0): DecideContext =>
  ({
    studioId: 'std_1' as StudioId,
    actor: { type: actorType, id: 'usr_owner' as never },
    now: instant(now),
    correlationId: 'cor_1' as CorrelationId,
    source: 'reception_web',
  }) as DecideContext

const gun = (over: Partial<TimesheetDay> = {}): TimesheetDay => ({
  date: '2026-10-05',
  planned: { start: '10:00', end: '21:00', breakMinutes: 180, netMinutes: 480 },
  actualPresenceMinutes: 659,
  actualBreakMinutes: 221,
  actualNetMinutes: 438,
  excessBreakMinutes: 41,
  netDeficitMinutes: 42,
  netSurplusMinutes: 0,
  retroEntryCount: 0,
  autoClosedCount: 0,
  ...over,
})

const snapshot = (over: Partial<Omit<WeeklyTimesheet, 'version' | 'generatedAt' | 'generatedBy' | 'signedAt' | 'signedBy'>> = {}) => ({
  weekStart: '2026-10-05',
  staffUserId: BEN,
  days: [gun()],
  plannedNetMinutes: 480,
  actualNetMinutes: 438,
  actualBreakMinutes: 221,
  excessBreakMinutes: 41,
  ...over,
})

const sheet = (over: Partial<WeeklyTimesheet> = {}): WeeklyTimesheet => ({
  ...snapshot(),
  version: 1,
  generatedAt: instant(T0),
  generatedBy: 'usr_owner' as StaffUserId,
  signedAt: null,
  signedBy: null,
  ...over,
})

describe('çizelge üretimi', () => {
  it('ilk üretim sürüm 1', () => {
    const r = decideGenerateTimesheet(ctx(), snapshot(), null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.version).toBe(1)
    expect(r.value.events[0]?.payload.version).toBe(1)
  })

  it('düzeltme sonrası YENİ sürüm üretir, eskisi silinmez', () => {
    const degisti = snapshot({ actualNetMinutes: 480, excessBreakMinutes: 0, days: [gun({ actualNetMinutes: 480, excessBreakMinutes: 0 })] })
    const r = decideGenerateTimesheet(ctx(), degisti, sheet())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.next.version).toBe(2)
  })

  it('AYNI içerik yeniden üretilmez — imzalanacak kâğıdı çoğaltmaz', () => {
    const r = decideGenerateTimesheet(ctx(), snapshot(), sheet())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('timesheet_unchanged')
  })

  it('YENİ sürüm İMZASIZ başlar — önceki imza yeni kâğıdı kapsamaz', () => {
    const imzali = sheet({ signedAt: instant(T0), signedBy: BEN })
    const degisti = snapshot({ actualNetMinutes: 500, days: [gun({ actualNetMinutes: 500 })] })
    const r = decideGenerateTimesheet(ctx(), degisti, imzali)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.signedAt).toBeNull()
    expect(r.value.next.signedBy).toBeNull()
  })

  it('sonradan girilen mola sayısı olaya düşer (#11)', () => {
    const r = decideGenerateTimesheet(ctx(), snapshot({ days: [gun({ retroEntryCount: 2 })] }), null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.events[0]?.payload.retroEntryCount).toBe(2)
  })

  it('eğitmen çizelge üretemez', () => {
    const r = decideGenerateTimesheet(ctx('trainer'), snapshot(), null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('break_correction_forbidden')
  })
})

describe('ıslak imza', () => {
  it('imza işaretlenir', () => {
    const r = decideSignTimesheet(ctx('receptionist'), sheet())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.signedAt).toBe(instant(T0))
    expect(r.value.events[0]?.payload.version).toBe(1)
  })

  it('İKİNCİ kez imzalanamaz', () => {
    const r = decideSignTimesheet(ctx(), sheet({ signedAt: instant(T0), signedBy: BEN }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('timesheet_already_signed')
  })

  it('eğitmen imza işaretleyemez', () => {
    const r = decideSignTimesheet(ctx('trainer'), sheet())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('break_correction_forbidden')
  })
})

// ── HAFTANIN ÇİZELGEYE ÇEVRİLMESİ ───────────────────────────────────────────────────────────
//
// Saatler stüdyo yerel saatiyle yazılıyor (UTC+3) ki tablo okunabilsin.
const OFF = 180
const yerel = (date: string, hhmm: string): number => {
  const [sa, dk] = hhmm.split(':').map(Number) as [number, number]
  return (instantFromLocalDate(date, OFF) as number) + (sa * 60 + dk) * 60_000
}

const vardiya = (id: string, date: string, bas: string, bit: string | null, over: Partial<StaffShift> = {}): StaffShift => ({
  id,
  staffUserId: BEN,
  branchId: null,
  startedAt: instant(yerel(date, bas)),
  endedAt: bit === null ? null : instant(yerel(date, bit)),
  lastCrossingAt: null,
  ...over,
})

const mola = (id: string, shiftId: string, date: string, bas: string, bit: string | null, source: StaffBreak['source'] = 'live'): StaffBreak => ({
  id,
  staffUserId: BEN,
  shiftId,
  startedAt: instant(yerel(date, bas)),
  endedAt: bit === null ? null : instant(yerel(date, bit)),
  source,
})

const hafta = (over: Partial<Parameters<typeof buildTimesheetSnapshot>[0]> = {}) =>
  buildTimesheetSnapshot({
    weekStart: '2026-10-05',
    staffUserId: BEN,
    planned: { '2026-10-05': { start: '10:00', end: '19:00', breakMinutes: 60 } },
    shifts: [],
    breaks: [],
    utcOffsetMinutes: OFF,
    ...over,
  })

describe('haftanın çizelgeye çevrilmesi', () => {
  it('yedi gün üretir, pazartesiden pazara — hiç hareket olmasa da', () => {
    const s = hafta()
    expect(s.days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    expect(s.plannedNetMinutes).toBe(480)
    expect(s.actualNetMinutes).toBe(0)
    // Planı olan ama hiç gelinmeyen gün: eksik, planın tamamı kadar.
    expect(s.days[0]?.netDeficitMinutes).toBe(480)
  })

  it('plana TAM uyan gün: fazla da eksik de 0', () => {
    const s = hafta({
      shifts: [vardiya('v1', '2026-10-05', '10:00', '19:00')],
      breaks: [mola('m1', 'v1', '2026-10-05', '13:00', '14:00')],
    })
    expect(s.days[0]).toMatchObject({
      actualPresenceMinutes: 540,
      actualBreakMinutes: 60,
      actualNetMinutes: 480,
      excessBreakMinutes: 0,
      netDeficitMinutes: 0,
      netSurplusMinutes: 0,
    })
  })

  it('planlı mola aşılırsa fark GİZLENMEZ: plan dışı ve eksik net ayrı yazılır', () => {
    const s = hafta({
      shifts: [vardiya('v1', '2026-10-05', '10:00', '19:00')],
      breaks: [mola('m1', 'v1', '2026-10-05', '13:00', '14:00'), mola('m2', 'v1', '2026-10-05', '16:00', '16:27')],
    })
    expect(s.days[0]).toMatchObject({ actualBreakMinutes: 87, excessBreakMinutes: 27, actualNetMinutes: 453, netDeficitMinutes: 27 })
    expect(s.excessBreakMinutes).toBe(27)
  })

  it('59 saniye bir dakika değildir', () => {
    const v = vardiya('v1', '2026-10-05', '10:00', '19:00', { endedAt: instant(yerel('2026-10-05', '19:00') + 59_000) })
    expect(hafta({ shifts: [v] }).days[0]?.actualPresenceMinutes).toBe(540)
  })

  it('AÇIK mola sayılmaz — bitmemiş bir molanın uzunluğu bilinmiyor', () => {
    const s = hafta({
      shifts: [vardiya('v1', '2026-10-05', '10:00', '19:00')],
      breaks: [mola('m1', 'v1', '2026-10-05', '13:00', null)],
    })
    expect(s.days[0]?.actualBreakMinutes).toBe(0)
    expect(s.days[0]?.actualNetMinutes).toBe(540)
  })

  it('kapanmamış vardiya SON GEÇİŞE kadar sayılır; geçişi yoksa 0 — bitiş uydurulmaz (#11)', () => {
    const gecisli = vardiya('v1', '2026-10-05', '10:00', null, { lastCrossingAt: instant(yerel('2026-10-05', '17:30')) })
    expect(hafta({ shifts: [gecisli] }).days[0]?.actualPresenceMinutes).toBe(450)
    expect(hafta({ shifts: [vardiya('v1', '2026-10-05', '10:00', null)] }).days[0]?.actualPresenceMinutes).toBe(0)
  })

  it('gece yarısını geçen vardiya BAŞLADIĞI güne yazılır, ikiye bölünmez', () => {
    const v = vardiya('v1', '2026-10-05', '20:00', null, { endedAt: instant(yerel('2026-10-06', '01:00')) })
    const s = hafta({ shifts: [v] })
    expect(s.days[0]?.actualPresenceMinutes).toBe(300)
    expect(s.days[1]?.actualPresenceMinutes).toBe(0)
  })

  it('hafta sınırı YEREL saatle: pazar 23:59 içeride, pazartesi 00:00 dışarıda', () => {
    const s = hafta({
      shifts: [
        vardiya('pazar', '2026-10-11', '23:59', null, { endedAt: instant(yerel('2026-10-12', '00:29')) }),
        vardiya('sonraki', '2026-10-12', '00:00', '01:00'),
        vardiya('onceki', '2026-10-04', '23:59', null, { endedAt: instant(yerel('2026-10-05', '00:59')) }),
      ],
    })
    expect(s.days[6]?.actualPresenceMinutes).toBe(30)
    expect(s.days.reduce((a, d) => a + d.actualPresenceMinutes, 0)).toBe(30)
  })

  it('mola VARDİYASININ gününe yazılır — gece yarısından sonra bitse de', () => {
    const v = vardiya('v1', '2026-10-05', '20:00', null, { endedAt: instant(yerel('2026-10-06', '02:00')) })
    const m: StaffBreak = { ...mola('m1', 'v1', '2026-10-06', '00:10', '00:40') }
    const s = hafta({ shifts: [v], breaks: [m] })
    expect(s.days[0]?.actualBreakMinutes).toBe(30)
    expect(s.days[1]?.actualBreakMinutes).toBe(0)
  })

  it('başkasının vardiyası ve molası sayılmaz', () => {
    const baskasi = 'usr_2' as StaffUserId
    const s = hafta({
      shifts: [vardiya('v2', '2026-10-05', '10:00', '19:00', { staffUserId: baskasi })],
      breaks: [{ ...mola('m2', 'v2', '2026-10-05', '13:00', '14:00'), staffUserId: baskasi }],
    })
    expect(s.actualNetMinutes).toBe(0)
    expect(s.actualBreakMinutes).toBe(0)
  })

  it('mola bulunmadan uzunsa net 0 olur, eksiye düşmez', () => {
    const s = hafta({
      shifts: [vardiya('v1', '2026-10-05', '10:00', '10:20')],
      breaks: [mola('m1', 'v1', '2026-10-05', '10:00', '10:45')],
    })
    expect(s.days[0]?.actualNetMinutes).toBe(0)
  })

  it('PLAN YOK ≠ 0 saat plan: planı olmayan günde çalışma yazılır, kıyas yazılmaz', () => {
    const s = hafta({ planned: null, shifts: [vardiya('v1', '2026-10-06', '10:00', '14:00')] })
    expect(s.days[1]).toMatchObject({ planned: null, actualNetMinutes: 240, netSurplusMinutes: 0, netDeficitMinutes: 0, excessBreakMinutes: 0 })
    expect(s.plannedNetMinutes).toBe(0)
  })

  it('molası yazılmamış eski plan: mola 0 sayılır, net = brüt', () => {
    const s = hafta({ planned: { '2026-10-05': { start: '10:00', end: '19:00' } } })
    expect(s.days[0]?.planned).toEqual({ start: '10:00', end: '19:00', breakMinutes: 0, netMinutes: 540 })
  })

  it('sonradan girilen ve otomatik kapanan molalar AYRI sayılır (#11) — süreleri de toplama girer', () => {
    const s = hafta({
      shifts: [vardiya('v1', '2026-10-05', '10:00', '19:00')],
      breaks: [
        mola('m1', 'v1', '2026-10-05', '12:00', '12:20'),
        mola('m2', 'v1', '2026-10-05', '14:00', '14:20', 'retro_entry'),
        mola('m3', 'v1', '2026-10-05', '16:00', '16:20', 'auto_closed'),
      ],
    })
    expect(s.days[0]).toMatchObject({ actualBreakMinutes: 60, retroEntryCount: 1, autoClosedCount: 1 })
  })
})

describe('aynı kâğıt mı', () => {
  it('ANAHTAR SIRASI içeriği değiştirmez — depodan dönen belge başka sırayla gelebilir', () => {
    const a = snapshot()
    const ters = Object.fromEntries(Object.entries(gun()).reverse()) as unknown as TimesheetDay
    expect(sameTimesheetContent(a, { ...a, days: [ters] })).toBe(true)
    // Ve üretim kararı da aynı cevabı verir: sırası farklı aynı kâğıt yeni sürüm olmaz.
    const r = decideGenerateTimesheet(ctx(), a, sheet({ days: [ters] }))
    expect(r.ok).toBe(false)
  })

  it('tek bir dakika fark, farklı kâğıttır', () => {
    const a = snapshot()
    expect(sameTimesheetContent(a, { ...a, days: [gun({ actualBreakMinutes: 222 })] })).toBe(false)
  })
})
