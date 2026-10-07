import { describe, expect, it } from 'vitest'

import {
  compareDay,
  dayTotals,
  minimumBreakMinutes,
  netWorkMinutes,
  validatePlannedWeek,
  type PlannedDay,
  type WorkingTimeLimits,
} from './working-time'

// Stüdyonun sınırları VERİ olarak geliyor — hesap dosyası hiçbir sayıyı bilmiyor (#4).
const LIMITS: WorkingTimeLimits = {
  legalNormalWeeklyMaxMinutes: 2700, // 45:00
  dailyNetMaxMinutes: 660, // 11:00
  breakTiers: [
    { uptoNetMinutes: 240, minBreakMinutes: 15 }, // <= 4:00
    { uptoNetMinutes: 450, minBreakMinutes: 30 }, // > 4:00 ve <= 7:30
    { uptoNetMinutes: null, minBreakMinutes: 60 }, // > 7:30
  ],
}

const gun = (start: string, end: string, breakMinutes: number): PlannedDay => ({ start, end, breakMinutes })

// ── OWNER'IN ŞABLONLARI (2026-10-06) ───────────────────────────────────────────────────────
// Stüdyo saatleri: Pzt–Cum 10:00–21:00 · Cmt 11:00–17:00 · Paz kapalı.
const HAFTA_ICI = (breakMinutes: number) => gun('10:00', '21:00', breakMinutes)
const WEEK_A: readonly PlannedDay[] = [120, 120, 120, 120, 120].map(HAFTA_ICI)
const WEEK_B: readonly PlannedDay[] = [
  HAFTA_ICI(180), // Pzt net 8:00
  HAFTA_ICI(180), // Sal
  HAFTA_ICI(180), // Çar
  HAFTA_ICI(180), // Per
  HAFTA_ICI(210), // Cum net 7:30
  gun('11:00', '17:00', 30), // Cmt net 5:30
]

describe('owner şablonları tam 45:00 net veriyor', () => {
  it('WEEK A — 5 × 09:00 = 45:00', () => {
    const r = validatePlannedWeek(WEEK_A, LIMITS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.netMinutes).toBe(2700)
      expect(r.value.breakMinutes).toBe(600) // 5 × 2:00
      expect(r.value.workedDays).toBe(5)
    }
  })

  it('WEEK B — 8+8+8+8+7:30+5:30 = 45:00', () => {
    const r = validatePlannedWeek(WEEK_B, LIMITS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.netMinutes).toBe(2700)
      expect(r.value.breakMinutes).toBe(960) // 16:00
      expect(r.value.workedDays).toBe(6)
    }
  })

  // Her iki şablon da üç sınırın TAM üstünde: haftalık 45:00, Pzt–Per molası 60 dk minimumun
  // üstünde, Cumartesi molası TAM 30 dk minimum. Bir karşılaştırma "kesin küçük" olsa bu testler
  // düşerdi — stüdyo kendi çizelgesini kaydedemezdi.
  it('Cumartesi molası TAM minimumda ve kabul ediliyor', () => {
    const cmt = gun('11:00', '17:00', 30)
    const t = dayTotals(cmt)!
    expect(t.netMinutes).toBe(330) // 5:30
    expect(minimumBreakMinutes(t.netMinutes, LIMITS.breakTiers)).toBe(30)
    expect(validatePlannedWeek([cmt], LIMITS).ok).toBe(true)
  })
})

describe('haftalık normal süre tavanı — hedef değil, tavan', () => {
  it('45:01 REDDEDİLİR ve kaç olduğunu söyler', () => {
    const fazla = [...WEEK_A.slice(0, 4), gun('10:00', '21:01', 120)] // net 541
    const r = validatePlannedWeek(fazla, LIMITS)
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.code === 'weekly_normal_work_exceeded') {
      expect(r.error.netMinutes).toBe(2701)
      expect(r.error.allowedMinutes).toBe(2700)
    } else expect.unreachable('weekly_normal_work_exceeded beklenirdi')
  })

  it('45:00 ALTINDA kalan plan da geçerli — sistem 45 saate TAMAMLAMAYA çalışmaz', () => {
    const r = validatePlannedWeek(WEEK_A.slice(0, 3), LIMITS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.netMinutes).toBe(1620) // 27:00
  })
})

describe('günlük net sınırı', () => {
  it('11:00 GEÇERLİ', () => {
    const r = validatePlannedWeek([gun('09:00', '21:00', 60)], LIMITS) // net 660
    expect(r.ok).toBe(true)
  })

  it('11:01 REDDEDİLİR', () => {
    const r = validatePlannedWeek([gun('09:00', '21:01', 60)], LIMITS) // net 661
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.code === 'daily_net_work_exceeded') {
      expect(r.error.netMinutes).toBe(661)
      expect(r.error.allowedMinutes).toBe(660)
    } else expect.unreachable('daily_net_work_exceeded beklenirdi')
  })
})

describe('ara dinlenmesi minimumu — eşik NET çalışmaya bakar', () => {
  it('kademeler: 4:00 ve 7:30 sınırları kapsayıcı', () => {
    expect(minimumBreakMinutes(240, LIMITS.breakTiers)).toBe(15) // tam 4:00
    expect(minimumBreakMinutes(241, LIMITS.breakTiers)).toBe(30)
    expect(minimumBreakMinutes(450, LIMITS.breakTiers)).toBe(30) // tam 7:30
    expect(minimumBreakMinutes(451, LIMITS.breakTiers)).toBe(60)
  })

  it('8:00 net + 0:30 mola REDDEDİLİR', () => {
    const r = validatePlannedWeek([gun('10:00', '18:30', 30)], LIMITS) // net 480
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.code === 'break_below_minimum') {
      expect(r.error.netMinutes).toBe(480)
      expect(r.error.requiredMinutes).toBe(60)
      expect(r.error.breakMinutes).toBe(30)
    } else expect.unreachable('break_below_minimum beklenirdi')
  })

  it('8:00 net + 1:00 mola GEÇERLİ', () => {
    expect(validatePlannedWeek([gun('10:00', '19:00', 60)], LIMITS).ok).toBe(true) // net 480
  })

  it('7:30 net + 0:30 mola GEÇERLİ', () => {
    expect(validatePlannedWeek([gun('10:00', '18:00', 30)], LIMITS).ok).toBe(true) // net 450
  })

  it('7:31 net + 0:30 mola REDDEDİLİR', () => {
    const r = validatePlannedWeek([gun('10:00', '18:01', 30)], LIMITS) // net 451
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('break_below_minimum')
  })

  it('kademe listesi boşsa plan doğrulanmaz — olmayan bir kural uydurulmaz', () => {
    const r = validatePlannedWeek(WEEK_A, { ...LIMITS, breakTiers: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('working_time_limits_missing')
  })
})

describe('günün brüt/net hesabı', () => {
  it('çıkış girişten sonra değilse geçersiz', () => {
    expect(dayTotals(gun('10:00', '10:00', 0))).toBeNull()
    expect(dayTotals(gun('21:00', '10:00', 0))).toBeNull()
  })

  it('mola brütten uzun olamaz', () => {
    expect(dayTotals(gun('10:00', '11:00', 61))).toBeNull()
  })

  it('mola tamsayı dakika olmalı', () => {
    expect(dayTotals(gun('10:00', '18:00', 30.5))).toBeNull()
    expect(dayTotals(gun('10:00', '18:00', -1))).toBeNull()
  })

  it('geçersiz saat biçimi reddedilir', () => {
    expect(dayTotals(gun('9:00', '18:00', 30))).toBeNull()
    expect(dayTotals(gun('10:00', '25:00', 30))).toBeNull()
  })
})

describe('net çalışma = bulunma − mola', () => {
  it('mola çalışmaya EKLENMEZ: 11:00 bulunma − 3:00 mola = 8:00', () => {
    expect(netWorkMinutes(660, 180)).toBe(480)
  })

  it('eksiye düşmez — çıkışı okutup sonra molayı bitiren biri', () => {
    expect(netWorkMinutes(60, 90)).toBe(0)
  })
})

describe('plan ile gerçek karşılaştırması — kayıt içindir, kesinti değil', () => {
  // owner'ın §12 örneği: plan 10:00–21:00, mola 3:00, net 8:00 · gerçek giriş 10:02, çıkış 21:01,
  // mola 3:41 → net 7:18. Fazla mola +00:41, eksik net −00:42.
  it("owner'ın örneği birebir çıkıyor", () => {
    const plan = dayTotals(HAFTA_ICI(180))!
    const k = compareDay(plan, { presenceMinutes: 659, breakMinutes: 221 })
    expect(plan.netMinutes).toBe(480) // 8:00
    expect(k.actualNetMinutes).toBe(438) // 7:18
    expect(k.excessBreakMinutes).toBe(41) // +00:41
    expect(k.netDeficitMinutes).toBe(42) // −00:42
    expect(k.netSurplusMinutes).toBe(0)
  })

  it('planından az mola kullanan için fazla mola 0, fazla çalışma görünür', () => {
    const plan = dayTotals(HAFTA_ICI(180))!
    const k = compareDay(plan, { presenceMinutes: 660, breakMinutes: 120 })
    expect(k.excessBreakMinutes).toBe(0)
    expect(k.netSurplusMinutes).toBe(60)
    expect(k.netDeficitMinutes).toBe(0)
  })
})
