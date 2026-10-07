import { err, localDateAt, ok, type DomainError, type NewEvent, type Result, type StaffUserId } from '../../../shared'
import {
  STAFF_TIMESHEET_GENERATED,
  STAFF_TIMESHEET_SIGNED,
  type StaffTimesheetGeneratedPayload,
  type StaffTimesheetSignedPayload,
} from '../events'
import { envelope, type DecideContext } from './decide'
import type { ShiftBlock, StaffBreak, StaffShift, TimesheetDay, WeeklyTimesheet } from './types'
import { weekDates } from './week-plan'
import { compareDay, dayTotals, netWorkMinutes } from './working-time'

// ── HAFTALIK ÇİZELGE VE ISLAK İMZA (owner, 2026-10-07) ──────────────────────────────────────
//
// Pazar çizelge üretilir, pazartesi imzalanır. Üretilen şey DONMUŞ bir snapshot: imzalanan kâğıt ile
// sistemdeki kayıt sonsuza kadar birebir kalmalı. Düzeltme `version`'ı artırır ve YENİ bir kâğıt
// üretir; eski sürüm silinmez (#9).
//
// SAF: snapshot'ı çağıran hesaplar (çalışma süresi aritmetiği `working-time.ts`te), buradaki karar
// yalnızca "üretilebilir mi" ve "imzalanabilir mi" sorularını cevaplar.

/** Çizelgeyi ÜRETEN ve İMZA ALAN: patron ve resepsiyon. */
const masa = (ctx: DecideContext): boolean =>
  ctx.actor.type === 'owner' || ctx.actor.type === 'receptionist' || ctx.actor.type === 'platform_admin'

/** Üretilecek kâğıdın içeriği — sürüm, üreten ve imza HARİÇ. */
export type TimesheetSnapshot = Omit<WeeklyTimesheet, 'version' | 'generatedAt' | 'generatedBy' | 'signedAt' | 'signedBy'>

// ALANLAR TEK TEK VE SABİT SIRAYLA yazılıyor, nesnenin kendisi değil: `JSON.stringify` anahtar
// sırasına duyarlı, ve depodan okunan bir belgenin anahtar sırası üretildiği andaki sırayla aynı
// olmak zorunda değil. Nesneyi olduğu gibi dizgeye çevirmek, aynı içeriği "farklı" sayar ve aynı
// kâğıdı her basışta yeni bir sürüm olarak çoğaltırdı.
const ozet = (s: Pick<WeeklyTimesheet, 'days' | 'plannedNetMinutes' | 'actualNetMinutes' | 'actualBreakMinutes' | 'excessBreakMinutes'>) =>
  JSON.stringify([
    s.days.map((d) => [
      d.date,
      d.planned ? [d.planned.start, d.planned.end, d.planned.breakMinutes, d.planned.netMinutes] : null,
      d.actualPresenceMinutes,
      d.actualBreakMinutes,
      d.actualNetMinutes,
      d.excessBreakMinutes,
      d.netDeficitMinutes,
      d.netSurplusMinutes,
      d.retroEntryCount,
      d.autoClosedCount,
    ]),
    s.plannedNetMinutes,
    s.actualNetMinutes,
    s.actualBreakMinutes,
    s.excessBreakMinutes,
  ])

/** İki çizelge AYNI KÂĞIT mı? Ekranın "kayıt güncel mi" sorusu ile üretimin ret kuralı tek cevap verir. */
export const sameTimesheetContent = (
  a: Parameters<typeof ozet>[0],
  b: Parameters<typeof ozet>[0],
): boolean => ozet(a) === ozet(b)

const dk = (bas: number, bit: number): number => Math.max(0, Math.floor((bit - bas) / 60_000))

/**
 * Bir kişinin bir haftasını çizelgeye çevirir — SAF: plan, vardiyalar ve molalar içeri girer,
 * yedi gün dışarı çıkar. Saat okumaz; "şu an" diye bir şey bilmez.
 *
 *   · Vardiya, BAŞLADIĞI yerel güne aittir. Gece yarısını geçen bir mesai tek vardiyadır ve iki
 *     güne bölünmez — bölünseydi tek bir çalışma iki ayrı günün toplamında görünürdü.
 *   · Kapanmamış vardiya SON GEÇİŞİNE kadar sayılır; geçişi de yoksa 0. Gözlenmemiş bir bitiş
 *     uydurulmaz (#11) — "şimdiye kadar" saymak aynı vardiyayı her üretimde biraz daha uzatırdı.
 *   · Mola, VARDİYASININ gününe aittir (kendi saatine değil): mola o vardiyanın bulunma süresinden
 *     düşülüyor. Vardiyası bu haftanın dışındaysa mola da dışarıdadır.
 *   · AÇIK mola sayılmaz: bitmemiş bir molanın uzunluğu bilinmiyor.
 *   · Planı olmayan günde karşılaştırma YOK — fazla/eksik 0 yazılır, çünkü kıyaslanacak bir şey yok.
 *     "Plan yok" ile "0 saat plan" aynı şey değildir.
 */
export function buildTimesheetSnapshot(input: {
  readonly weekStart: string
  readonly staffUserId: StaffUserId
  /** Bu kişinin YAYINDAKİ planı, gün → blok. Hafta onaylanmadıysa `null`. */
  readonly planned: Readonly<Record<string, ShiftBlock>> | null
  readonly shifts: readonly StaffShift[]
  readonly breaks: readonly StaffBreak[]
  readonly utcOffsetMinutes: number
}): TimesheetSnapshot {
  const benim = input.shifts.filter((v) => v.staffUserId === input.staffUserId)
  const gunu = new Map(benim.map((v) => [v.id, localDateAt(v.startedAt, input.utcOffsetMinutes) as string]))

  const days: TimesheetDay[] = weekDates(input.weekStart).map((date) => {
    const vardiyalar = benim.filter((v) => gunu.get(v.id) === date)
    const presence = vardiyalar.reduce(
      (a, v) => a + dk(v.startedAt as number, (v.endedAt ?? v.lastCrossingAt ?? v.startedAt) as number),
      0,
    )
    const molalar = input.breaks.filter(
      (m) => m.staffUserId === input.staffUserId && m.endedAt !== null && gunu.get(m.shiftId) === date,
    )
    const breakMinutes = molalar.reduce((a, m) => a + dk(m.startedAt as number, m.endedAt as number), 0)

    const blok = input.planned?.[date] ?? null
    const plan = blok ? dayTotals({ start: blok.start, end: blok.end, breakMinutes: blok.breakMinutes ?? 0 }) : null
    const fark = plan ? compareDay(plan, { presenceMinutes: presence, breakMinutes }) : null
    return {
      date,
      planned:
        blok && plan
          ? { start: blok.start, end: blok.end, breakMinutes: plan.breakMinutes, netMinutes: plan.netMinutes }
          : null,
      actualPresenceMinutes: presence,
      actualBreakMinutes: breakMinutes,
      actualNetMinutes: fark?.actualNetMinutes ?? netWorkMinutes(presence, breakMinutes),
      excessBreakMinutes: fark?.excessBreakMinutes ?? 0,
      netDeficitMinutes: fark?.netDeficitMinutes ?? 0,
      netSurplusMinutes: fark?.netSurplusMinutes ?? 0,
      retroEntryCount: molalar.filter((m) => m.source === 'retro_entry').length,
      autoClosedCount: molalar.filter((m) => m.source === 'auto_closed').length,
    }
  })

  const topla = (f: (d: TimesheetDay) => number) => days.reduce((a, d) => a + f(d), 0)
  return {
    weekStart: input.weekStart,
    staffUserId: input.staffUserId,
    days,
    plannedNetMinutes: topla((d) => d.planned?.netMinutes ?? 0),
    actualNetMinutes: topla((d) => d.actualNetMinutes),
    actualBreakMinutes: topla((d) => d.actualBreakMinutes),
    excessBreakMinutes: topla((d) => d.excessBreakMinutes),
  }
}

/**
 * Haftanın çizelgesini üretir. `version` her üretimde artar; aynı içerik yeniden üretilmez.
 *
 * Aynı içeriği yeni bir sürüm olarak basmak, imzalanacak kâğıt sayısını çoğaltır ve hiçbir şey
 * söylemez. Değişen bir şey varsa yeni sürüm, yoksa ret.
 */
export function decideGenerateTimesheet(
  ctx: DecideContext,
  snapshot: TimesheetSnapshot,
  mevcut: WeeklyTimesheet | null,
): Result<
  { next: WeeklyTimesheet; events: NewEvent<typeof STAFF_TIMESHEET_GENERATED, StaffTimesheetGeneratedPayload>[] },
  DomainError
> {
  if (!masa(ctx)) return err({ code: 'break_correction_forbidden' })
  const next: WeeklyTimesheet = {
    ...snapshot,
    version: (mevcut?.version ?? 0) + 1,
    generatedAt: ctx.now,
    generatedBy: ctx.actor.type === 'system' ? null : (String(ctx.actor.id) as WeeklyTimesheet['generatedBy']),
    // Yeni sürüm imzasız başlar: önceki imza yeni kâğıdı kapsamaz.
    signedAt: null,
    signedBy: null,
  }
  if (mevcut && ozet(mevcut) === ozet(next)) return err({ code: 'timesheet_unchanged' })

  const retro = next.days.reduce((a, d) => a + d.retroEntryCount, 0)
  return ok({
    next,
    events: [
      {
        ...envelope(ctx, next.staffUserId),
        type: STAFF_TIMESHEET_GENERATED,
        payload: {
          weekStart: next.weekStart,
          staffUserId: next.staffUserId as string,
          version: next.version,
          plannedNetMinutes: next.plannedNetMinutes,
          actualNetMinutes: next.actualNetMinutes,
          actualBreakMinutes: next.actualBreakMinutes,
          excessBreakMinutes: next.excessBreakMinutes,
          retroEntryCount: retro,
        },
      },
    ],
  })
}

/**
 * İmzanın alındığını işaretler. Kâğıdın kendisi sistemin dışında kalır — burada duran tek şey
 * imzanın alındığı; böylece panel "imzasız hafta" diye uyarabilir.
 */
export function decideSignTimesheet(
  ctx: DecideContext,
  sheet: WeeklyTimesheet,
): Result<
  { next: WeeklyTimesheet; events: NewEvent<typeof STAFF_TIMESHEET_SIGNED, StaffTimesheetSignedPayload>[] },
  DomainError
> {
  if (!masa(ctx)) return err({ code: 'break_correction_forbidden' })
  if (sheet.signedAt !== null) return err({ code: 'timesheet_already_signed' })
  const next: WeeklyTimesheet = {
    ...sheet,
    signedAt: ctx.now,
    signedBy: String(ctx.actor.id) as WeeklyTimesheet['signedBy'],
  }
  return ok({
    next,
    events: [
      {
        ...envelope(ctx, sheet.staffUserId),
        type: STAFF_TIMESHEET_SIGNED,
        payload: { weekStart: sheet.weekStart, staffUserId: sheet.staffUserId as string, version: sheet.version },
      },
    ],
  })
}
