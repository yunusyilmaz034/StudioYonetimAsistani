import { err, ok, type DomainError, type NewEvent, type Result } from '../../../shared'
import {
  STAFF_TIMESHEET_GENERATED,
  STAFF_TIMESHEET_SIGNED,
  type StaffTimesheetGeneratedPayload,
  type StaffTimesheetSignedPayload,
} from '../events'
import { envelope, type DecideContext } from './decide'
import type { WeeklyTimesheet } from './types'

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

const ozet = (s: WeeklyTimesheet) =>
  JSON.stringify({
    days: s.days,
    plannedNetMinutes: s.plannedNetMinutes,
    actualNetMinutes: s.actualNetMinutes,
    actualBreakMinutes: s.actualBreakMinutes,
    excessBreakMinutes: s.excessBreakMinutes,
  })

/**
 * Haftanın çizelgesini üretir. `version` her üretimde artar; aynı içerik yeniden üretilmez.
 *
 * Aynı içeriği yeni bir sürüm olarak basmak, imzalanacak kâğıt sayısını çoğaltır ve hiçbir şey
 * söylemez. Değişen bir şey varsa yeni sürüm, yoksa ret.
 */
export function decideGenerateTimesheet(
  ctx: DecideContext,
  snapshot: Omit<WeeklyTimesheet, 'version' | 'generatedAt' | 'generatedBy' | 'signedAt' | 'signedBy'>,
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
