import { describe, expect, it } from 'vitest'

import { instant, type CorrelationId, type StaffUserId, type StudioId } from '../../../shared'
import type { DecideContext } from './decide'
import { decideGenerateTimesheet, decideSignTimesheet } from './timesheet'
import type { TimesheetDay, WeeklyTimesheet } from './types'

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
