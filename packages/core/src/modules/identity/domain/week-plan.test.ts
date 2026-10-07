import { describe, expect, it } from 'vitest'

import { instant, instantFromLocalDate, type CorrelationId, type StaffUserId, type StudioId } from '../../../shared'
import type { DecideContext } from './decide'
import type { StaffLeave, StaffWeekPlan, WeekPlanEntries } from './types'
import type { WorkingTimeLimits } from './working-time'
import {
  decideApproveWeekPlan,
  decideReturnWeekPlan,
  decideSaveWeekPlanDraft,
  decideSubmitWeekPlan,
  leaveDaysInWeek,
  mondayOf,
  planVsActual,
  weekDates,
} from './week-plan'

// HAFTALIK VARDİYA PLANI (owner, 2026-09-14 · OR-77). Bu testlerin konusu, sistemin REDDETMESİ
// gereken hâller ve sınırlar: geçmiş hafta, yetkisiz onay, geçersiz saat, değişmemiş taslak.

const OFF = 180
const HAFTA = '2026-09-21' // pazartesi
const CUMA = '2026-09-18'
const NOW = instant(1_789_725_600_000)
const AYSE = 'usr_ayse'
const BUSE = 'usr_buse'

const ctxOf = (type: 'owner' | 'receptionist' | 'trainer'): DecideContext => ({
  studioId: 'std_1' as StudioId,
  actor: { type, id: `usr_${type}` as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
})
const RESEPSIYON = ctxOf('receptionist')
const OWNER = ctxOf('owner')

const plan: WeekPlanEntries = {
  [AYSE]: { '2026-09-21': { start: '09:00', end: '17:00' }, '2026-09-22': { start: '09:00', end: '17:00' } },
}

const kaydet = (entries: WeekPlanEntries, current: StaffWeekPlan | null = null, ctx = RESEPSIYON, today = CUMA) =>
  decideSaveWeekPlanDraft(ctx, current, { weekStart: HAFTA, entries }, today, null)

/** Resepsiyon kaydetti, gönderdi; owner onayladı. */
function yayinda(): StaffWeekPlan {
  const t = kaydet(plan)
  if (!t.ok) throw new Error('kaydet')
  const g = decideSubmitWeekPlan(RESEPSIYON, t.value.next, CUMA)
  if (!g.ok) throw new Error('gönder')
  const o = decideApproveWeekPlan(OWNER, g.value.next, CUMA)
  if (!o.ok) throw new Error('onayla')
  return o.value.next
}

describe('hafta ve gün', () => {
  it('pazartesinin pazartesisi kendisidir, pazarın pazartesisi altı gün öncedir', () => {
    expect(mondayOf('2026-09-14')).toBe('2026-09-14')
    expect(mondayOf('2026-09-20')).toBe('2026-09-14')
    expect(mondayOf('2026-09-21')).toBe('2026-09-21')
  })
  it('hafta pazartesiden pazara yedi gündür', () => {
    expect(weekDates(HAFTA)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])
  })
})

describe('taslak', () => {
  it('resepsiyon kaydeder: taslak doğar, olay sayıları taşır — isim değil', () => {
    const r = kaydet(plan)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('draft')
    expect(r.value.next.published).toBeNull()
    expect(r.value.events.map((e) => e.type)).toEqual(['staff.week_plan_draft_saved'])
    expect(r.value.events[0]?.payload).toEqual({ weekStart: HAFTA, staffCount: 1, blockCount: 2 })
    expect(r.value.events[0]?.subject).toEqual({ kind: 'staffWeekPlan', id: HAFTA })
  })

  it('REDDEDER: eğitmen planı düzenleyemez', () => {
    expect(kaydet(plan, null, ctxOf('trainer'))).toEqual({ ok: false, error: { code: 'week_plan_editor_required' } })
  })

  it('REDDEDER: geçmiş hafta — ama haftanın pazarı hâlâ bu haftadır (sınır)', () => {
    expect(kaydet(plan, null, RESEPSIYON, '2026-09-28')).toEqual({ ok: false, error: { code: 'week_plan_past' } })
    expect(kaydet(plan, null, RESEPSIYON, '2026-09-27').ok).toBe(true)
  })

  it('REDDEDER: çıkış girişten önce ya da aynı saatte (09:00–09:00 bir yazım hatasıdır)', () => {
    const esit = { [AYSE]: { '2026-09-21': { start: '09:00', end: '09:00' } } }
    const ters = { [AYSE]: { '2026-09-21': { start: '17:00', end: '09:00' } } }
    expect(kaydet(esit)).toEqual({ ok: false, error: { code: 'invalid_time_range' } })
    expect(kaydet(ters)).toEqual({ ok: false, error: { code: 'invalid_time_range' } })
    expect(kaydet({ [AYSE]: { '2026-09-21': { start: '09:00', end: '09:01' } } }).ok).toBe(true)
  })

  it('REDDEDER: SS:DD olmayan saat, haftaya ait olmayan gün, pazartesi olmayan hafta', () => {
    expect(kaydet({ [AYSE]: { '2026-09-21': { start: '9:00', end: '17:00' } } })).toEqual({ ok: false, error: { code: 'week_plan_invalid' } })
    expect(kaydet({ [AYSE]: { '2026-09-28': { start: '09:00', end: '17:00' } } })).toEqual({ ok: false, error: { code: 'week_plan_invalid' } })
    expect(decideSaveWeekPlanDraft(RESEPSIYON, null, { weekStart: '2026-09-22', entries: plan }, CUMA, null)).toEqual({
      ok: false,
      error: { code: 'week_plan_invalid' },
    })
  })

  it('aynı taslağı ikinci kez kaydetmek olay yazmaz', () => {
    const ilk = kaydet(plan)
    if (!ilk.ok) throw new Error()
    const ikinci = kaydet(plan, ilk.value.next)
    expect(ikinci.ok && ikinci.value.events).toEqual([])
  })

  it('hiç planı olmayan haftaya boş kaydetmek olay yazmaz', () => {
    const r = kaydet({})
    expect(r.ok && r.value.events).toEqual([])
  })
})

describe('onaya gönderme', () => {
  it('taslak onaya gider, değişen gün sayısı olayda', () => {
    const t = kaydet(plan)
    if (!t.ok) throw new Error()
    const r = decideSubmitWeekPlan(RESEPSIYON, t.value.next, CUMA)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('submitted')
    expect(r.value.events[0]?.payload).toEqual({ weekStart: HAFTA, staffCount: 1, blockCount: 2, changedDays: 2 })
  })

  it('çift tıklama ikinci bir olay yazmaz', () => {
    const t = kaydet(plan)
    if (!t.ok) throw new Error()
    const g = decideSubmitWeekPlan(RESEPSIYON, t.value.next, CUMA)
    if (!g.ok) throw new Error()
    const tekrar = decideSubmitWeekPlan(RESEPSIYON, g.value.next, CUMA)
    expect(tekrar.ok && tekrar.value.events).toEqual([])
  })

  it('REDDEDER: yayındakiyle aynı taslak — gönderilecek bir değişiklik yok', () => {
    expect(decideSubmitWeekPlan(RESEPSIYON, yayinda(), CUMA)).toEqual({ ok: false, error: { code: 'week_plan_unchanged' } })
  })

  it('REDDEDER: hiç kaydedilmemiş hafta', () => {
    expect(decideSubmitWeekPlan(RESEPSIYON, null, CUMA)).toEqual({ ok: false, error: { code: 'week_plan_unchanged' } })
  })
})

describe('onay ve geri gönderme', () => {
  const gonderilmis = () => {
    const t = kaydet(plan)
    if (!t.ok) throw new Error()
    const g = decideSubmitWeekPlan(RESEPSIYON, t.value.next, CUMA)
    if (!g.ok) throw new Error()
    return g.value.next
  }

  it('owner onaylar: plan yayına çıkar, olay haftanın bütün saatlerini taşır', () => {
    const r = decideApproveWeekPlan(OWNER, gonderilmis(), CUMA)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('published')
    expect(r.value.next.published).toEqual(plan)
    expect(r.value.next.version).toBe(1)
    expect(r.value.events[0]?.payload).toEqual({
      weekStart: HAFTA,
      version: 1,
      blocks: [
        { staffUserId: AYSE, date: '2026-09-21', start: '09:00', end: '17:00' },
        { staffUserId: AYSE, date: '2026-09-22', start: '09:00', end: '17:00' },
      ],
    })
  })

  it('REDDEDER: resepsiyon kendi hazırladığı planı onaylayamaz', () => {
    expect(decideApproveWeekPlan(RESEPSIYON, gonderilmis(), CUMA)).toEqual({ ok: false, error: { code: 'week_plan_approver_required' } })
  })

  it('REDDEDER: onaya gönderilmemiş taslak onaylanmaz', () => {
    const t = kaydet(plan)
    if (!t.ok) throw new Error()
    expect(decideApproveWeekPlan(OWNER, t.value.next, CUMA)).toEqual({ ok: false, error: { code: 'week_plan_not_submitted' } })
  })

  it('REDDEDER: sebepsiz geri gönderme', () => {
    expect(decideReturnWeekPlan(OWNER, gonderilmis(), '   ')).toEqual({ ok: false, error: { code: 'reason_required' } })
  })

  it('geri gönderilen plan taslak olur ve sebep görünür; yeniden gönderince sebep temizlenir', () => {
    const r = decideReturnWeekPlan(OWNER, gonderilmis(), 'Pazartesi resepsiyon eksik')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('draft')
    expect(r.value.next.returnReason).toBe('Pazartesi resepsiyon eksik')
    expect(r.value.events[0]?.payload).toEqual({ weekStart: HAFTA, reason: 'Pazartesi resepsiyon eksik' })
    const tekrar = decideSubmitWeekPlan(RESEPSIYON, r.value.next, CUMA)
    expect(tekrar.ok && tekrar.value.next.returnReason).toBe('')
  })
})

// OR-77, karar 2: yayından sonraki değişiklik yeniden onay ister; personel o arada ESKİ saati görür.
describe('yayından sonra değişiklik', () => {
  const degisik: WeekPlanEntries = {
    [AYSE]: { '2026-09-21': { start: '10:00', end: '18:00' }, '2026-09-22': { start: '09:00', end: '17:00' } },
    [BUSE]: { '2026-09-23': { start: '12:00', end: '21:00' } },
  }

  it('düzenleme planı taslağa döndürür ama yayındaki plan DEĞİŞMEZ', () => {
    const r = kaydet(degisik, yayinda())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('draft')
    expect(r.value.next.published).toEqual(plan)
  })

  it('yeniden gönderimde yalnızca değişen günler sayılır; onay sürümü ikiye çıkar', () => {
    const t = kaydet(degisik, yayinda())
    if (!t.ok) throw new Error()
    const g = decideSubmitWeekPlan(RESEPSIYON, t.value.next, CUMA)
    expect(g.ok && g.value.events[0]?.payload).toMatchObject({ changedDays: 2 })
    if (!g.ok) return
    const o = decideApproveWeekPlan(OWNER, g.value.next, CUMA)
    expect(o.ok && o.value.next.version).toBe(2)
  })

  it('yayındakine geri dönülürse bekleyen değişiklik kalmaz', () => {
    const t = kaydet(degisik, yayinda())
    if (!t.ok) throw new Error()
    const geri = kaydet(plan, t.value.next)
    expect(geri.ok && geri.value.next.status).toBe('published')
  })
})

describe('izinli günler (uyarının verisi)', () => {
  const izin = (over: Partial<StaffLeave>): StaffLeave => ({
    id: 'lv_1',
    staffUserId: AYSE as StaffUserId,
    kind: 'rapor',
    from: instantFromLocalDate('2026-09-22', OFF)!,
    to: instant((instantFromLocalDate('2026-09-23', OFF) as number) + 86_400_000 - 1),
    note: '',
    status: 'approved',
    requestedAt: NOW,
    decidedBy: null,
    decidedAt: null,
    decisionReason: '',
    ...over,
  })

  it('onaylı izin aralığındaki her gün işaretlenir, sınırın dışı işaretlenmez', () => {
    expect(leaveDaysInWeek(HAFTA, [izin({})], OFF)).toEqual({ [AYSE]: { '2026-09-22': 'rapor', '2026-09-23': 'rapor' } })
  })

  it('bekleyen izin sayılmaz — henüz yokluk değil, istek', () => {
    expect(leaveDaysInWeek(HAFTA, [izin({ status: 'pending' })], OFF)).toEqual({})
  })
})

describe('plan ile turnike (yalnızca görünür)', () => {
  const gun = instantFromLocalDate('2026-09-21', OFF) as number
  const saat = (h: number, m: number) => gun + (h * 60 + m) * 60_000
  const blok = { start: '09:00', end: '17:00' }

  it('25 dk geç gelen, 20 dk erken çıkan', () => {
    const r = planVsActual('2026-09-21', blok, saat(9, 25), saat(16, 40), OFF)
    expect(r).toMatchObject({ lateMinutes: 25, earlyMinutes: 20 })
  })

  it('erken gelen ve geç çıkan 0 — fark eksiye düşmez', () => {
    expect(planVsActual('2026-09-21', blok, saat(8, 50), saat(17, 30), OFF)).toMatchObject({ lateMinutes: 0, earlyMinutes: 0 })
  })

  it('geçiş yoksa fark da yok', () => {
    expect(planVsActual('2026-09-21', blok, null, null, OFF)).toMatchObject({ lateMinutes: null, earlyMinutes: null })
  })

  it('sınır: tam planlı saatte gelen 0 dk geçtir, bir dakika sonra gelen 1', () => {
    expect(planVsActual('2026-09-21', blok, saat(9, 0), null, OFF)?.lateMinutes).toBe(0)
    expect(planVsActual('2026-09-21', blok, saat(9, 1), null, OFF)?.lateMinutes).toBe(1)
  })
})

// ── ÇALIŞMA SÜRESİ SINIRLARI (owner, 2026-10-06/07 · OR-119) ────────────────────────────────
//
// Sınırlar VERİ: `null` geçilirse hiç sınanmaz (yukarıdaki tüm testler böyle çalışıyor ve davranış
// değişmedi). Geçilirse üç kural da REDDEDER — ve reddin içinde sayılar var, çünkü resepsiyona
// "olmadı" demek yetmez, kaçı aştığını söylemek gerekir.

const LIMITS: WorkingTimeLimits = {
  legalNormalWeeklyMaxMinutes: 2700, // 45:00
  dailyNetMaxMinutes: 660, // 11:00
  breakTiers: [
    { uptoNetMinutes: 240, minBreakMinutes: 15 },
    { uptoNetMinutes: 450, minBreakMinutes: 30 },
    { uptoNetMinutes: null, minBreakMinutes: 60 },
  ],
}

const sinirlaKaydet = (entries: WeekPlanEntries) =>
  decideSaveWeekPlanDraft(RESEPSIYON, null, { weekStart: HAFTA, entries }, CUMA, LIMITS)

/** Owner'ın WEEK A şablonu: beş gün 10:00–21:00, 2:00 mola → günlük net 9:00, haftalık tam 45:00. */
const haftaIci = (breakMinutes: number) => ({ start: '10:00', end: '21:00', breakMinutes })
const BES_GUN = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']

describe('plan çalışma süresi sınırları', () => {
  it('owner şablonu tam 45:00 net — sınırda olmak aşmak değildir', () => {
    const entries: WeekPlanEntries = { [AYSE]: Object.fromEntries(BES_GUN.map((d) => [d, haftaIci(120)])) }
    expect(sinirlaKaydet(entries).ok).toBe(true)
  })

  it('haftalık 45:00 aşılırsa reddedilir ve kaç dakika olduğu söylenir', () => {
    const entries: WeekPlanEntries = {
      [AYSE]: { ...Object.fromEntries(BES_GUN.map((d) => [d, haftaIci(120)])), '2026-09-26': haftaIci(120) },
    }
    const r = sinirlaKaydet(entries)
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.code === 'weekly_normal_work_exceeded') {
      expect(r.error.netMinutes).toBe(3240) // 6 × 9:00 = 54:00
      expect(r.error.allowedMinutes).toBe(2700)
    } else expect.unreachable('weekly_normal_work_exceeded beklenirdi')
  })

  it('günlük 11:00 net aşılırsa reddedilir — haftalık toplam hâlâ sınır altında olsa bile', () => {
    const entries: WeekPlanEntries = { [AYSE]: { '2026-09-21': { start: '09:00', end: '21:00', breakMinutes: 30 } } }
    const r = sinirlaKaydet(entries)
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.code === 'daily_net_work_exceeded') {
      expect(r.error.netMinutes).toBe(690) // 12:00 − 0:30
      expect(r.error.allowedMinutes).toBe(660)
    } else expect.unreachable('daily_net_work_exceeded beklenirdi')
  })

  it('mola kademenin altındaysa reddedilir', () => {
    const entries: WeekPlanEntries = { [AYSE]: { '2026-09-21': haftaIci(30) } }
    const r = sinirlaKaydet(entries)
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.code === 'break_below_minimum') {
      expect(r.error.netMinutes).toBe(630)
      expect(r.error.requiredMinutes).toBe(60)
    } else expect.unreachable('break_below_minimum beklenirdi')
  })

  it('molası HİÇ yazılmamış gün net = brüt sayılır ve mola minimumundan düşer', () => {
    // Bilinçli: "mola planlanmamış" ile "0 mola planlanmış" aynı şey değil, ve sayım BLOKE etme
    // yönünde hata yapıyor. Eski planlar bu yüzden açılıp molaları doldurulmadan kaydedilemez.
    const entries: WeekPlanEntries = { [AYSE]: { '2026-09-21': { start: '10:00', end: '21:00' } } }
    const r = sinirlaKaydet(entries)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('break_below_minimum')
  })

  it('sınır yoksa (null) hiçbir şey sınanmaz — yasa stüdyo ayarından gelir, koddan değil', () => {
    const entries: WeekPlanEntries = { [AYSE]: { '2026-09-21': { start: '09:00', end: '21:00' } } }
    const r = decideSaveWeekPlanDraft(RESEPSIYON, null, { weekStart: HAFTA, entries }, CUMA, null)
    expect(r.ok).toBe(true)
  })
})
