import { err, ok, type DomainError, type Result } from '../../../shared'
import { dakika, gecerliSaat } from './week-plan'

// ── ÇALIŞMA SÜRESİ VE ARA DİNLENMESİ (owner, 2026-10-06/07) ─────────────────────────────────
//
// SAF: I/O yok, saat yok, ve en önemlisi — BU DOSYA HİÇBİR SAYIYI BİLMEZ. 45, 11, 15/30/60 burada
// yazılı değil; hepsi `WorkingTimeLimits` olarak dışarıdan gelir (#4: "policy is versioned data,
// never an `if`. Nothing in the code knows the number six.").
//
// Gerekçesi owner'ın kendi kuralından geliyor: OR-72 bir İK yazılımı yazmayı reddederken sebebini
// yazmıştı — *"İş Kanunu'nu koda gömer ve her yıl çürür."* Sayılar veride durursa kanun değişince
// kod değişmez; çürüyen şey olmaz.
//
// ── TAMSAYI DAKİKA, FLOAT SAAT DEĞİL ───────────────────────────────────────────────────────
//
// Para tamsayı kuruş olduğu için neyse, süre de tamsayı dakika. Float saatle `45.000000001 > 45`
// çıkar ve stüdyonun kendi çizelgesi reddedilir. Mevcut teamül de bu: vardiya süresi
// `Math.floor(ms/60_000)` ile yazılıyor, *"59 saniye bir dakika değildir."*
//
// ── SINIRLAR KAPSAYICI ─────────────────────────────────────────────────────────────────────
//
// Owner'ın verdiği şablonlar üç sınırın TAM üstünde duruyor: haftalık tam 45:00, Pzt–Per molası tam
// 60 dk, Cumartesi molası tam 30 dk. Bir karşılaştırma bile "kesin küçük" yazılsa sistem stüdyonun
// kendi varsayılan çizelgesini reddederdi. O yüzden hepsi `<=` ve `>=`.

/** Net çalışma süresine göre en az ne kadar ara dinlenmesi gerekir. `uptoNetMinutes: null` = en üst kademe. */
export interface BreakTier {
  readonly uptoNetMinutes: number | null
  readonly minBreakMinutes: number
}

/**
 * Stüdyonun çalışma süresi sınırları. VERİ — koda yazılmaz.
 *
 * `legalNormalWeeklyMaxMinutes` yasal üst sınırdır, HEDEF DEĞİL (owner, 2026-10-06: *"45 saat bir
 * zorunluluk değil… MAXIMUM NORMAL WEEKLY WORK olarak modellenmeli"*). Bir personelin sözleşmesi
 * 40 saat olabilir; o `contractWeeklyMinutes`tır ve bu sınırla aynı şey değildir.
 */
export interface WorkingTimeLimits {
  readonly legalNormalWeeklyMaxMinutes: number
  readonly dailyNetMaxMinutes: number
  /** Artan `uptoNetMinutes` sırasında beklenir; son kademe `null` taşır. */
  readonly breakTiers: readonly BreakTier[]
}

/** Bir günün PLANI: stüdyo yerel saatiyle giriş/çıkış, ve planlanan toplam mola. */
export interface PlannedDay {
  readonly start: string
  readonly end: string
  readonly breakMinutes: number
}

export interface DayTotals {
  readonly grossMinutes: number
  readonly breakMinutes: number
  readonly netMinutes: number
}

export interface WeekTotals {
  readonly grossMinutes: number
  readonly breakMinutes: number
  readonly netMinutes: number
  readonly workedDays: number
}

/**
 * Net çalışma = işyerinde bulunma − ara dinlenmesi.
 *
 * Sıfırda sabitleniyor: mola bulunma süresinden uzun görünebilir (molayı çıkış okuttuktan sonra
 * bitiren biri) ve eksi çalışma diye bir şey yoktur. Sabitlenen durum çağıran tarafından ihlal
 * olarak işaretlenir — gizlenmez.
 */
export const netWorkMinutes = (presenceMinutes: number, breakMinutes: number): number =>
  Math.max(0, presenceMinutes - breakMinutes)

/**
 * Bu net çalışma için gereken en az ara dinlenmesi.
 *
 * Eşik NET çalışmaya bakar (owner, 2026-10-06). Brüt bulunmaya bakmak farklı bir cevap verebilir:
 * brüt 8:00 + 60 dk mola = net 7:00 → nette "30 dk" kademesi, brütte "60 dk" kademesi.
 */
export function minimumBreakMinutes(netMinutes: number, tiers: readonly BreakTier[]): number {
  for (const t of tiers) {
    if (t.uptoNetMinutes === null || netMinutes <= t.uptoNetMinutes) return t.minBreakMinutes
  }
  // Kademe listesi en üst kademeyi (`null`) taşımıyorsa bilinen bir minimum yok: 0 demek, olmayan
  // bir kuralı uydurmaktan iyidir. Doğrulama yine de kademelerin eksikliğini reddeder.
  return 0
}

/** Bir günün brüt/mola/net süresi. Saat biçimi geçersizse ya da çıkış girişten sonra değilse `null`. */
export function dayTotals(day: PlannedDay): DayTotals | null {
  if (!gecerliSaat(day.start) || !gecerliSaat(day.end)) return null
  if (!Number.isInteger(day.breakMinutes) || day.breakMinutes < 0) return null
  const gross = dakika(day.end) - dakika(day.start)
  if (gross <= 0) return null
  if (day.breakMinutes > gross) return null
  return { grossMinutes: gross, breakMinutes: day.breakMinutes, netMinutes: gross - day.breakMinutes }
}

/**
 * NORMAL haftalık planı doğrular. Üç kural, hepsi kapsayıcı sınırla:
 *
 *   · günlük net <= `dailyNetMaxMinutes`              (11:00 geçerli, 11:01 değil)
 *   · planlanan mola >= kademenin minimumu            (tam minimum geçerli)
 *   · haftalık net <= `legalNormalWeeklyMaxMinutes`   (45:00 geçerli, 45:01 değil)
 *
 * 45 saate TAMAMLAMAYA çalışmaz: bu bir tavan denetimidir, hedef değil.
 */
export function validatePlannedWeek(
  days: readonly PlannedDay[],
  limits: WorkingTimeLimits,
): Result<WeekTotals, DomainError> {
  if (limits.breakTiers.length === 0) return err({ code: 'working_time_limits_missing' })
  let gross = 0
  let breaks = 0
  let net = 0
  for (const day of days) {
    const t = dayTotals(day)
    if (t === null) return err({ code: 'invalid_time_range' })
    if (t.netMinutes > limits.dailyNetMaxMinutes) {
      return err({ code: 'daily_net_work_exceeded', netMinutes: t.netMinutes, allowedMinutes: limits.dailyNetMaxMinutes })
    }
    const required = minimumBreakMinutes(t.netMinutes, limits.breakTiers)
    if (t.breakMinutes < required) {
      return err({ code: 'break_below_minimum', netMinutes: t.netMinutes, breakMinutes: t.breakMinutes, requiredMinutes: required })
    }
    gross += t.grossMinutes
    breaks += t.breakMinutes
    net += t.netMinutes
  }
  if (net > limits.legalNormalWeeklyMaxMinutes) {
    return err({ code: 'weekly_normal_work_exceeded', netMinutes: net, allowedMinutes: limits.legalNormalWeeklyMaxMinutes })
  }
  return ok({ grossMinutes: gross, breakMinutes: breaks, netMinutes: net, workedDays: days.length })
}

/** PLAN ile GERÇEK arasındaki fark. Kayıt ve rapor içindir; hiçbir ücret kesintisi üretmez. */
export interface DayComparison {
  readonly plannedNetMinutes: number
  readonly plannedBreakMinutes: number
  readonly actualNetMinutes: number
  readonly actualBreakMinutes: number
  /** Planlanandan fazla kullanılan mola. Az kullanıldıysa 0. */
  readonly excessBreakMinutes: number
  /** Plana göre eksik kalan net çalışma. Fazla çalışıldıysa 0. */
  readonly netDeficitMinutes: number
  /** Plana göre fazla yapılan net çalışma. Eksik kaldıysa 0. */
  readonly netSurplusMinutes: number
}

export function compareDay(
  planned: DayTotals,
  actual: { readonly presenceMinutes: number; readonly breakMinutes: number },
): DayComparison {
  const actualNet = netWorkMinutes(actual.presenceMinutes, actual.breakMinutes)
  return {
    plannedNetMinutes: planned.netMinutes,
    plannedBreakMinutes: planned.breakMinutes,
    actualNetMinutes: actualNet,
    actualBreakMinutes: actual.breakMinutes,
    excessBreakMinutes: Math.max(0, actual.breakMinutes - planned.breakMinutes),
    netDeficitMinutes: Math.max(0, planned.netMinutes - actualNet),
    netSurplusMinutes: Math.max(0, actualNet - planned.netMinutes),
  }
}
